/**
 * SPEC-021: segurança de acesso.
 *
 * CA cobertos: CA-01..CA-15, CA-21 (entrego) e CA-R1..CA-R5 (não-regrido).
 * CA-16/CA-17 são da tela (docs/revisoes/evidencias/spec-021-verificar.mjs); CA-18..CA-20, da migration
 * (docs/migrations/SPEC-021.md).
 *
 * Sobe o AppModule real (guard JWT, throttler e ValidationPipe) com o AllExceptionsFilter registrado como
 * no main.ts e o CORS configurado pela mesma função do main.ts. O banco é um SQLite descartável, criado a
 * cada teste a partir das migrations do projeto. O prisma/dev.db não é tocado.
 */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { configurarCors } from '../src/cors';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

function criarBancoDescartavel(): string {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec021-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

describe('SPEC-021: segurança de acesso', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: { id: number };
  let comum: { id: number };
  let tokenAdmin: string;
  let tokenComum: string;
  const assinar = (u: { id: number; email: string }) =>
    new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: u.id, email: u.email }, { expiresIn: '1h' });

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }) });
    const senha = bcrypt.hashSync('senha-certa', 10);
    const a = await prisma.usuarios.create({ data: { nome: 'Admin', email: 'admin@teste.com', senha, isAdmin: true } });
    const c = await prisma.usuarios.create({ data: { nome: 'Comum', email: 'comum@teste.com', senha } });
    admin = a; comum = c;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    configurarCors(app); // como em src/main.ts
    await app.init();

    tokenAdmin = assinar(a);
    tokenComum = assinar(c);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  const http = (token?: string) => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string, body: object) => auth(request(server).post(url)).send(body),
      patch: (url: string, body: object) => auth(request(server).patch(url)).send(body),
      delete: (url: string) => auth(request(server).delete(url)),
    };
  };
  const login = (email: string, senha: string, ip = '10.0.0.1') =>
    request(app.getHttpServer()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, senha });
  const novo = { nome: 'Ana', email: 'ana@exemplo.com', senha: 'abc123' };

  describe('quem administra usuários (RF-82)', () => {
    it('CA-01: POST /usuarios sem token 401, comum 403, admin 201', async () => {
      expect((await http().post('/usuarios', novo)).status).toBe(401);
      const comumRes = await http(tokenComum).post('/usuarios', novo);
      expect(comumRes.status).toBe(403);
      expect(comumRes.body.message).toBe('Apenas administradores podem criar usuários');
      expect(await prisma.usuarios.count()).toBe(2);
      expect((await http(tokenAdmin).post('/usuarios', novo)).status).toBe(201);
    });

    it('CA-02: comum edita só a própria conta; a senha nova entra no login', async () => {
      const outro = await http(tokenComum).patch(`/usuarios/${admin.id}`, { nome: 'Hack' });
      expect(outro.status).toBe(403);
      expect(outro.body.message).toBe('Você só pode editar a própria conta');
      expect((await prisma.usuarios.findUnique({ where: { id: admin.id } }))!.nome).toBe('Admin');

      // SPEC-022 (RF-93 altera o RF-82): trocar a própria senha pede a senha atual
      const proprio = await http(tokenComum).patch(`/usuarios/${comum.id}`, { nome: 'Comum 2', email: 'comum2@teste.com', senha: 'nova-senha', senhaAtual: 'senha-certa' });
      expect(proprio.status).toBe(200);
      expect(proprio.body.nome).toBe('Comum 2');
      expect((await login('comum2@teste.com', 'nova-senha')).status).toBe(201);
    });

    it('CA-03: comum mandando isAdmin na própria conta → 403, continua comum', async () => {
      const res = await http(tokenComum).patch(`/usuarios/${comum.id}`, { isAdmin: true });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Apenas administradores podem alterar o papel');
      expect((await prisma.usuarios.findUnique({ where: { id: comum.id } }))!.isAdmin).toBe(false);
    });

    it('CA-04: admin edita outro usuário, inclusive o papel', async () => {
      const res = await http(tokenAdmin).patch(`/usuarios/${comum.id}`, { nome: 'Promovido', email: 'promovido@teste.com', senha: 'x1', isAdmin: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nome: 'Promovido', email: 'promovido@teste.com', isAdmin: true });
    });

    it('CA-05: DELETE só admin, e não de si mesmo', async () => {
      const comumRes = await http(tokenComum).delete(`/usuarios/${admin.id}`);
      expect(comumRes.status).toBe(403);
      expect(comumRes.body.message).toBe('Apenas administradores podem excluir usuários');
      const si = await http(tokenAdmin).delete(`/usuarios/${admin.id}`);
      expect(si.status).toBe(400);
      expect(si.body.message).toBe('Você não pode excluir a própria conta');
      expect(await prisma.usuarios.count()).toBe(2);
      expect((await http(tokenAdmin).delete(`/usuarios/${comum.id}`)).status).toBe(200);
      expect(await prisma.usuarios.count()).toBe(1);
    });

    it('CA-06: o último admin não perde o papel; com dois, pode', async () => {
      const ultimo = await http(tokenAdmin).patch(`/usuarios/${admin.id}`, { isAdmin: false });
      expect(ultimo.status).toBe(409);
      expect(ultimo.body.message).toBe('É preciso ter pelo menos um administrador');
      expect((await prisma.usuarios.findUnique({ where: { id: admin.id } }))!.isAdmin).toBe(true);

      await prisma.usuarios.update({ where: { id: comum.id }, data: { isAdmin: true } });
      expect((await http(tokenAdmin).patch(`/usuarios/${admin.id}`, { isAdmin: false })).status).toBe(200);
    });

    it('CA-07: GET devolve isAdmin e nunca senha', async () => {
      const lista = (await http(tokenComum).get('/usuarios')).body as Record<string, unknown>[];
      expect(lista.every((u) => typeof u.isAdmin === 'boolean' && !('senha' in u))).toBe(true);
      const um = (await http(tokenComum).get(`/usuarios/${admin.id}`)).body;
      expect(um.isAdmin).toBe(true);
      expect('senha' in um).toBe(false);
    });

    it('CA-21: usuário criado sem isAdmin nasce comum', async () => {
      const res = await http(tokenAdmin).post('/usuarios', novo);
      expect(res.body.isAdmin).toBe(false);
    });
  });

  describe('token (RF-05)', () => {
    it('CA-08: token de usuário excluído → 401', async () => {
      const t = assinar({ id: comum.id, email: 'comum@teste.com' });
      expect((await http(t).get('/tarefas')).status).toBe(200);
      await prisma.usuarios.delete({ where: { id: comum.id } });
      expect((await http(t).get('/tarefas')).status).toBe(401);
    });

    it('CA-09: promoção e rebaixamento valem na hora, com o mesmo token', async () => {
      expect((await http(tokenComum).post('/usuarios', novo)).status).toBe(403);
      await prisma.usuarios.update({ where: { id: comum.id }, data: { isAdmin: true } });
      expect((await http(tokenComum).post('/usuarios', novo)).status).toBe(201);
      await prisma.usuarios.update({ where: { id: comum.id }, data: { isAdmin: false } });
      expect((await http(tokenComum).post('/usuarios', { ...novo, email: 'outra@exemplo.com' })).status).toBe(403);
    });
  });

  describe('email (RF-83)', () => {
    it('CA-10: grava normalizado; repetido em maiúsculas → 409', async () => {
      const res = await http(tokenAdmin).post('/usuarios', { ...novo, email: '  Ana@Exemplo.COM ' });
      expect(res.status).toBe(201);
      expect(res.body.email).toBe('ana@exemplo.com');
      expect((await http(tokenAdmin).post('/usuarios', { ...novo, email: 'ANA@exemplo.com' })).status).toBe(409);
    });

    it('CA-11: login com email em outra caixa e com espaços entra', async () => {
      await http(tokenAdmin).post('/usuarios', novo);
      expect((await login(' ANA@exemplo.com ', 'abc123')).status).toBe(201);
    });

    it('CA-12: email sem @ → 400 no POST e no PATCH', async () => {
      expect((await http(tokenAdmin).post('/usuarios', { ...novo, email: 'ana' })).status).toBe(400);
      expect((await http(tokenComum).patch(`/usuarios/${comum.id}`, { email: 'ana' })).status).toBe(400);
    });
  });

  describe('CORS (RF-84)', () => {
    it('CA-13: só a origem permitida recebe o cabeçalho', async () => {
      const ok = await request(app.getHttpServer()).get('/auth/login').set('Origin', 'http://localhost:5173');
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      const mal = await request(app.getHttpServer()).get('/auth/login').set('Origin', 'http://malicioso.com');
      expect(mal.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('limite de login (RF-85)', () => {
    it('CA-14: a 6ª tentativa no minuto → 429; outro email do mesmo IP entra', async () => {
      for (let i = 0; i < 5; i++) expect((await login('comum@teste.com', 'errada')).status).toBe(401);
      const sexta = await login('comum@teste.com', 'senha-certa');
      expect(sexta.status).toBe(429);
      expect(sexta.body.message).toBe('Muitas tentativas de login. Tente de novo em 1 minuto.');
      expect((await login('admin@teste.com', 'senha-certa')).status).toBe(201);
    });

    it('CA-15: passado o minuto, volta a entrar', async () => {
      for (let i = 0; i < 6; i++) await login('comum@teste.com', 'errada', '10.0.0.9');
      expect((await login('comum@teste.com', 'senha-certa', '10.0.0.9')).status).toBe(429);
      const agora = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(agora + 61_000);
      expect((await login('comum@teste.com', 'senha-certa', '10.0.0.9')).status).toBe(201);
    });
  });

  describe('não-regrido', () => {
    it('CA-R1: login certo 201 com token; errado 401 "Credenciais inválidas"', async () => {
      const certo = await login('admin@teste.com', 'senha-certa', '10.0.0.2');
      expect(certo.status).toBe(201);
      expect(typeof certo.body.access_token).toBe('string');
      const errado = await login('admin@teste.com', 'nada', '10.0.0.2');
      expect(errado.status).toBe(401);
      expect(errado.body.message).toBe('Credenciais inválidas');
    });

    it('CA-R2: senha gravada como hash e fora das respostas', async () => {
      const res = await http(tokenAdmin).post('/usuarios', novo);
      expect('senha' in res.body).toBe(false);
      const gravado = await prisma.usuarios.findUnique({ where: { id: res.body.id } });
      expect(gravado!.senha).not.toBe('abc123');
      expect(bcrypt.compareSync('abc123', gravado!.senha)).toBe(true);
    });

    it('CA-R3: email repetido segue 409', async () => {
      expect((await http(tokenAdmin).post('/usuarios', { ...novo, email: 'comum@teste.com' })).status).toBe(409);
    });

    it('CA-R4: comum segue criando projeto, tarefa e label', async () => {
      const st = await prisma.statusProjeto.create({ data: { nome: 'Ativo', ordem: 1 } });
      const tt = await prisma.statusTarefa.create({ data: { nome: 'A fazer', ordem: 1 } });
      const p = await http(tokenComum).post('/projetos', { nome: 'P', idStatus: st.id });
      expect(p.status).toBe(201);
      expect((await http(tokenComum).post('/tarefas', { nome: 'T', idStatus: tt.id, prioridade: 'Alta', idProjeto: p.body.id })).status).toBe(201);
      expect((await http(tokenComum).post('/labels', { nome: 'L' })).status).toBe(201);
    });

    it('CA-R5: excluir usuário em uso segue 409', async () => {
      const st = await prisma.statusProjeto.create({ data: { nome: 'Ativo', ordem: 1 } });
      await http(tokenComum).post('/projetos', { nome: 'P', idStatus: st.id, membros: [comum.id] });
      expect((await http(tokenAdmin).delete(`/usuarios/${comum.id}`)).status).toBe(409);
    });
  });
});
