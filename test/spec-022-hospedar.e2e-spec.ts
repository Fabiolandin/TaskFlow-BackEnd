/**
 * SPEC-022: preparar para hospedar.
 *
 * CA cobertos: CA-01..CA-03, CA-05..CA-15 (entrego) e CA-R4 (não-regrido).
 * CA-04 e CA-18..CA-24 são da tela (docs/revisoes/evidencias/spec-022-verificar.mjs); CA-16/CA-17, da migration
 * (docs/migrations/SPEC-022.md).
 *
 * Sobe o AppModule real com o filtro, o CORS e o proxy configurados pelas mesmas funções do main.ts, sobre um
 * SQLite descartável criado a partir das migrations do projeto. O prisma/dev.db não é tocado.
 */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
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
import { PrismaService, caminhoDoBanco } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { configurarCors } from '../src/cors';
import { configurarProxy } from '../src/proxy';
import { tornarAdmin } from '../src/scripts/tornar-admin.logica';
import { UsuariosService } from '../src/usuarios/usuarios.service';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const RAIZ = path.join(__dirname, '..');

function criarBancoDescartavel(): string {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec022-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

describe('SPEC-022: preparar para hospedar', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: { id: number; email: string };
  let admin2: { id: number; email: string };
  let comum: { id: number; email: string };
  const proxyAntes = process.env.TRUST_PROXY;
  //token como o de antes desta spec: só sub e email (CA-10)
  const assinarAntigo = (u: { id: number; email: string }) =>
    new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: u.id, email: u.email }, { expiresIn: '1h' });

  const subir = async (trustProxy?: string) => {
    if (trustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = trustProxy;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    configurarCors(app); // como em src/main.ts
    configurarProxy(app); // como em src/main.ts
    await app.init();
  };

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }) });
    const senha = bcrypt.hashSync('senha-certa', 10);
    admin = await prisma.usuarios.create({ data: { nome: 'Admin', email: 'admin@teste.com', senha, isAdmin: true } });
    admin2 = await prisma.usuarios.create({ data: { nome: 'Admin 2', email: 'admin2@teste.com', senha, isAdmin: true } });
    comum = await prisma.usuarios.create({ data: { nome: 'Comum', email: 'comum@teste.com', senha } });
  });

  afterEach(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
    if (proxyAntes === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = proxyAntes;
  });

  const http = (token?: string) => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
    return {
      get: (url: string) => auth(request(server).get(url)),
      patch: (url: string, body: object) => auth(request(server).patch(url)).send(body),
      delete: (url: string) => auth(request(server).delete(url)),
    };
  };
  const login = (email: string, senha: string, ip?: string) => {
    const r = request(app.getHttpServer()).post('/auth/login');
    return (ip ? r.set('X-Forwarded-For', ip) : r).send({ email, senha });
  };
  const tokenDe = async (email: string, senha = 'senha-certa') => (await login(email, senha)).body.access_token as string;

  describe('IP do limite de login (RF-88, RF-89)', () => {
    it('CA-01: com TRUST_PROXY=1, o limite é por IP do cliente', async () => {
      await subir('1');
      for (let i = 0; i < 5; i++) expect((await login('comum@teste.com', 'errada', '1.1.1.1')).status).toBe(401);
      expect((await login('comum@teste.com', 'senha-certa', '1.1.1.1')).status).toBe(429);
      expect((await login('comum@teste.com', 'senha-certa', '2.2.2.2')).status).toBe(201);
    });

    it('CA-02: sem TRUST_PROXY, trocar o X-Forwarded-For não escapa do limite', async () => {
      await subir(undefined);
      for (let i = 0; i < 5; i++) expect((await login('comum@teste.com', 'errada', `9.9.9.${i}`)).status).toBe(401);
      expect((await login('comum@teste.com', 'senha-certa', '9.9.9.200')).status).toBe(429);
    });

    it('CA-03: IPv6 conta por /64', async () => {
      await subir('1');
      for (let i = 1; i <= 5; i++) expect((await login('comum@teste.com', 'errada', `2001:db8::${i}`)).status).toBe(401);
      expect((await login('comum@teste.com', 'senha-certa', '2001:db8::ffff')).status).toBe(429);
      expect((await login('comum@teste.com', 'senha-certa', '2001:db8:0:1::1')).status).toBe(201);
    });
  });

  describe('pelo menos um admin, ao mesmo tempo (RF-91)', () => {
    //Pelo HTTP os dois pedidos acabam em fila e o segundo já chega rebaixado (403), sem exercitar a corrida.
    //A janela real é: os dois já passaram pelo guard como admin e gravam ao mesmo tempo. Por isso o serviço
    //é chamado direto, com os dois "eu" admin, em paralelo
    const eu = (u: { id: number; email: string }) => ({ id: u.id, email: u.email, isAdmin: true });

    it('CA-05: dois admins se rebaixando ao mesmo tempo → sobra 1 admin, um pedido dá 409', async () => {
      await subir();
      const servico = app.get(UsuariosService);
      const r = await Promise.allSettled([
        servico.update(admin2.id, { isAdmin: false }, eu(admin)),
        servico.update(admin.id, { isAdmin: false }, eu(admin2)),
      ]);
      expect(await prisma.usuarios.count({ where: { isAdmin: true } })).toBe(1);
      const recusas = r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
      expect(recusas).toHaveLength(1);
      expect(recusas[0].reason).toBeInstanceOf(ConflictException);
      expect(recusas[0].reason.message).toBe('É preciso ter pelo menos um administrador');
    });

    it('CA-06: dois admins excluindo um ao outro ao mesmo tempo → sobra 1 admin', async () => {
      await subir();
      const servico = app.get(UsuariosService);
      const r = await Promise.allSettled([servico.remove(admin2.id, eu(admin)), servico.remove(admin.id, eu(admin2))]);
      expect(await prisma.usuarios.count({ where: { isAdmin: true } })).toBe(1);
      expect(r.filter((x) => x.status === 'rejected')).toHaveLength(1);
    });
  });

  describe('troca de senha derruba as sessões (RF-92, RF-93)', () => {
    it('CA-07: trocar a própria senha derruba o token antigo; o login novo vale', async () => {
      await subir();
      const antigo = await tokenDe('comum@teste.com');
      expect((await http(antigo).get('/tarefas')).status).toBe(200);
      const troca = await http(antigo).patch(`/usuarios/${comum.id}`, { senha: 'senha-nova-1', senhaAtual: 'senha-certa' });
      expect(troca.status).toBe(200);
      expect(troca.body).not.toHaveProperty('senha');
      expect(troca.body).not.toHaveProperty('senhaAlteradaEm');
      const depois = await http(antigo).get('/tarefas');
      expect(depois.status).toBe(401);
      expect(depois.body.message).toBe('Sessão encerrada: a senha foi alterada');
      const novo = await tokenDe('comum@teste.com', 'senha-nova-1');
      expect((await http(novo).get('/tarefas')).status).toBe(200);
    });

    it('CA-08: o admin troca a senha de outro → o token do outro cai; o do admin não', async () => {
      await subir();
      const tAdmin = await tokenDe('admin@teste.com');
      const tComum = await tokenDe('comum@teste.com');
      expect((await http(tAdmin).patch(`/usuarios/${comum.id}`, { senha: 'senha-nova-1' })).status).toBe(200);
      expect((await http(tComum).get('/tarefas')).status).toBe(401);
      expect((await http(tAdmin).get('/tarefas')).status).toBe(200);
    });

    it('CA-09: trocar só nome ou email não derruba o token', async () => {
      await subir();
      const t = await tokenDe('comum@teste.com');
      expect((await http(t).patch(`/usuarios/${comum.id}`, { nome: 'Comum 2', email: 'comum2@teste.com' })).status).toBe(200);
      expect((await http(t).get('/tarefas')).status).toBe(200);
    });

    it('CA-10: token sem o valor vale até a senha mudar', async () => {
      await subir();
      const antigo = assinarAntigo(comum);
      expect((await http(antigo).get('/tarefas')).status).toBe(200);
      await prisma.usuarios.update({ where: { id: comum.id }, data: { senhaAlteradaEm: new Date() } });
      expect((await http(antigo).get('/tarefas')).status).toBe(401);
    });

    it('CA-11: própria conta: senha sem a atual ou com a atual errada → 400 e nada muda', async () => {
      await subir();
      const t = await tokenDe('comum@teste.com');
      const sem = await http(t).patch(`/usuarios/${comum.id}`, { senha: 'senha-nova-1' });
      expect(sem.status).toBe(400);
      expect(sem.body.message).toBe('Informe a senha atual para trocar a senha');
      const errada = await http(t).patch(`/usuarios/${comum.id}`, { senha: 'senha-nova-1', senhaAtual: 'outra' });
      expect(errada.status).toBe(400);
      expect(errada.body.message).toBe('Senha atual incorreta');
      expect((await login('comum@teste.com', 'senha-certa')).status).toBe(201);
      expect((await prisma.usuarios.findUnique({ where: { id: comum.id } }))!.senhaAlteradaEm).toBeNull();
    });

    it('CA-12: o admin troca a senha de outro sem a senha atual', async () => {
      await subir();
      const t = await tokenDe('admin@teste.com');
      expect((await http(t).patch(`/usuarios/${comum.id}`, { senha: 'senha-nova-1' })).status).toBe(200);
      expect((await login('comum@teste.com', 'senha-nova-1')).status).toBe(201);
    });
  });

  it('CA-13: null em nome, email, senha ou isAdmin → 400 e nada muda', async () => {
    await subir();
    const t = assinarAntigo(admin);
    for (const campo of ['nome', 'email', 'senha', 'isAdmin']) {
      const r = await http(t).patch(`/usuarios/${comum.id}`, { [campo]: null });
      expect([campo, r.status]).toEqual([campo, 400]);
    }
    expect(await prisma.usuarios.findUnique({ where: { id: comum.id }, select: { nome: true, email: true, isAdmin: true } }))
      .toEqual({ nome: 'Comum', email: 'comum@teste.com', isAdmin: false });
  });

  it('CA-14: npm run admin recusa promover email sem formato válido', async () => {
    await prisma.usuarios.create({ data: { nome: 'Antigo', email: 'usuario1', senha: 'x' } });
    await expect(tornarAdmin(prisma, { email: 'usuario1', forcar: true, sim: true }, async () => '')).rejects.toThrow('Email inválido');
    expect((await prisma.usuarios.findUnique({ where: { email: 'usuario1' } }))!.isAdmin).toBe(false);
  });

  describe('banco pelo DATABASE_URL (RF-95)', () => {
    it('CA-15: caminho relativo resolve pela pasta do backend; sem variável, prisma/dev.db', () => {
      expect(caminhoDoBanco('file:./prisma/outro.db')).toBe(path.join(RAIZ, 'prisma', 'outro.db'));
      expect(caminhoDoBanco(undefined)).toBe(path.join(RAIZ, 'prisma', 'dev.db'));
      const abs = path.join(os.tmpdir(), 'x.db');
      expect(caminhoDoBanco(`file:${abs}`)).toBe(abs);
    });

    it('CA-15: o PrismaService abre o banco do DATABASE_URL, mesmo iniciado de outra pasta', async () => {
      const arquivo = criarBancoDescartavel();
      const db = new Database(arquivo);
      db.prepare(`INSERT INTO "Usuarios" (nome, email, senha, updatedAt) VALUES ('Marca', 'marca@teste.com', 'x', CURRENT_TIMESTAMP)`).run();
      db.close();
      const [antesUrl, antesCwd] = [process.env.DATABASE_URL, process.cwd()];
      process.env.DATABASE_URL = `file:${arquivo}`;
      process.chdir(os.tmpdir());
      const servico = new PrismaService();
      try {
        expect((await servico.usuarios.findMany({ select: { email: true } })).map((u) => u.email)).toEqual(['marca@teste.com']);
      } finally {
        await servico.$disconnect();
        process.chdir(antesCwd);
        if (antesUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = antesUrl;
      }
    });
  });

  it('CA-R4: login, limite e regras da SPEC-021 seguem (comum não edita outro; 6ª tentativa 429)', async () => {
    await subir();
    const t = await tokenDe('comum@teste.com');
    expect((await http(t).patch(`/usuarios/${admin.id}`, { nome: 'X' })).status).toBe(403);
    for (let i = 0; i < 5; i++) await login('admin2@teste.com', 'errada');
    expect((await login('admin2@teste.com', 'senha-certa')).status).toBe(429);
  });
});
