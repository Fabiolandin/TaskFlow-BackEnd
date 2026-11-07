/**
 * SPEC-004: quem criou a tarefa ou o comentário vem do token, não do corpo.
 *
 * CA cobertos: CA-B1, CA-B2, CA-B3, CA-R1, CA-R2, CA-R3, CA-R4.
 *
 * Sobe o AppModule real (guard JWT e ValidationPipe globais) com o AllExceptionsFilter
 * registrado como no main.ts. O banco é um SQLite descartável, criado a cada teste a
 * partir das migrations do projeto. O prisma/dev.db não é tocado.
 *
 * Receita da reprodução (spec, 06/11/2026): autenticado como A, `POST /tarefas` com
 * `idUsuarioCriador` de B gravava a tarefa como sendo de B.
 */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

function criarBancoDescartavel(): string {
  const arquivo = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec004-')),
    'test.db',
  );
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

describe('SPEC-004: identidade vem do token', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokenA: string;
  let ids: {
    a: number;
    b: number;
    projeto: number;
    tarefaExistente: number;
    comentarioExistente: number;
  };

  beforeEach(async () => {
    const arquivo = criarBancoDescartavel();
    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: arquivo }),
    });

    // Pré-condição da reprodução: dois usuários, A (o do token) e B (o do corpo).
    const a = await prisma.usuarios.create({
      data: { nome: 'Repro A', email: 'a@teste.com', senha: 'x' },
    });
    const b = await prisma.usuarios.create({
      data: { nome: 'Repro B', email: 'b@teste.com', senha: 'x' },
    });
    const projeto = await prisma.projetos.create({
      data: { nome: 'Projeto', idStatus: 1 },
    });
    // Registros "já existentes", criados por B, para o CA-R4.
    const tarefaExistente = await prisma.tarefas.create({
      data: {
        nome: 'Existente',
        idStatus: 1,
        prioridade: 'Alta',
        idUsuarioCriador: b.id,
        idProjeto: projeto.id,
      },
    });
    const comentarioExistente = await prisma.comentariosTarefas.create({
      data: { comentario: 'antigo', idTarefa: tarefaExistente.id, idUsuario: b.id },
    });

    ids = {
      a: a.id,
      b: b.id,
      projeto: projeto.id,
      tarefaExistente: tarefaExistente.id,
      comentarioExistente: comentarioExistente.id,
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    await app.init();

    tokenA = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: a.id, email: a.email },
      { expiresIn: '1h' },
    );
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const post = (url: string, body: object, token: string | null = tokenA) => {
    const r = request(app.getHttpServer()).post(url);
    if (token) r.set('Authorization', `Bearer ${token}`);
    return r.send(body);
  };

  const tarefaBase = () => ({
    nome: 'Repro identidade',
    idStatus: 1,
    prioridade: 'Alta',
    idProjeto: ids.projeto,
  });

  // ---------- CA-B ----------

  it('CA-B1: POST /tarefas com idUsuarioCriador de outro grava o usuário do token', async () => {
    const res = await post('/tarefas', { ...tarefaBase(), idUsuarioCriador: ids.b });
    expect(res.status).toBe(201);
    expect(res.body.idUsuarioCriador).toBe(ids.a);
    const gravada = await prisma.tarefas.findUnique({ where: { id: res.body.id } });
    expect(gravada?.idUsuarioCriador).toBe(ids.a);
  });

  it('CA-B2: POST /comentariostarefas com idUsuario de outro grava o usuário do token', async () => {
    const res = await post('/comentariostarefas', {
      comentario: 'oi',
      idTarefa: ids.tarefaExistente,
      idUsuario: ids.b,
    });
    expect(res.status).toBe(201);
    expect(res.body.idUsuario).toBe(ids.a);
    const gravado = await prisma.comentariosTarefas.findUnique({ where: { id: res.body.id } });
    expect(gravado?.idUsuario).toBe(ids.a);
  });

  it('CA-B3: POST /tarefas sem idUsuarioCriador no corpo é aceito (o campo saiu do DTO)', async () => {
    const res = await post('/tarefas', tarefaBase());
    expect(res.status).toBe(201);
    expect(res.body.idUsuarioCriador).toBe(ids.a);
  });

  it('CA-B3: POST /comentariostarefas sem idUsuario no corpo é aceito (o campo saiu do DTO)', async () => {
    const res = await post('/comentariostarefas', {
      comentario: 'oi',
      idTarefa: ids.tarefaExistente,
    });
    expect(res.status).toBe(201);
    expect(res.body.idUsuario).toBe(ids.a);
  });

  it('CA-B3: PATCH herda o DTO: idUsuarioCriador / idUsuario enviados são ignorados', async () => {
    const server = app.getHttpServer();
    const t = await request(server)
      .patch(`/tarefas/${ids.tarefaExistente}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ nome: 'Renomeada', idUsuarioCriador: ids.a });
    expect(t.status).toBe(200);
    expect(t.body.nome).toBe('Renomeada');
    expect(t.body.idUsuarioCriador).toBe(ids.b);

    // Emenda (SPEC-007, RF-36): só o autor edita; o comentário existente é de B, então o PATCH é feito com o token de B.
    const tokenB = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: ids.b, email: 'b@teste.com' },
      { expiresIn: '1h' },
    );
    const c = await request(server)
      .patch(`/comentariostarefas/${ids.comentarioExistente}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ comentario: 'editado', idUsuario: ids.a });
    expect(c.status).toBe(200);
    expect(c.body.comentario).toBe('editado');
    expect(c.body.idUsuario).toBe(ids.b);
  });

  // ---------- CA-R ----------
  // Os CA-R mandam no corpo o mesmo id do token (A): o corpo é válido antes da correção
  // (quando o campo é obrigatório) e ignorado depois. Assim passam antes e depois.
  const tarefaR = () => ({ ...tarefaBase(), idUsuarioCriador: ids.a });

  it('CA-R1: tarefa continua exigindo projeto (sem idProjeto → 400) e nasce com criador', async () => {
    const { idProjeto, ...semProjeto } = tarefaR();
    void idProjeto;
    const res = await post('/tarefas', semProjeto);
    expect(res.status).toBe(400);
    expect(await prisma.tarefas.count()).toBe(1);

    const ok = await post('/tarefas', tarefaR());
    expect(ok.status).toBe(201);
    expect(typeof ok.body.idUsuarioCriador).toBe('number');
    expect(ok.body.idProjeto).toBe(ids.projeto);
  });

  it('CA-R2: idUsuarioResponsavel continua opcional e continua vindo do corpo', async () => {
    // Ajuste de dado (SPEC-010, RF-26): o responsável precisa ser membro do projeto.
    await prisma.usuariosProjetos.create({ data: { idUsuario: ids.b, idProjeto: ids.projeto } });
    const comResp = await post('/tarefas', { ...tarefaR(), idUsuarioResponsavel: ids.b });
    expect(comResp.status).toBe(201);
    expect(comResp.body.idUsuarioResponsavel).toBe(ids.b);

    const semResp = await post('/tarefas', tarefaR());
    expect(semResp.status).toBe(201);
    expect(semResp.body.idUsuarioResponsavel).toBeNull();
  });

  it('CA-R3: sem token, as duas rotas respondem 401', async () => {
    const t = await post('/tarefas', { ...tarefaBase(), idUsuarioCriador: ids.a }, null);
    expect(t.status).toBe(401);
    const c = await post(
      '/comentariostarefas',
      { comentario: 'oi', idTarefa: ids.tarefaExistente, idUsuario: ids.a },
      null,
    );
    expect(c.status).toBe(401);
  });

  it('CA-R3: as duas rotas públicas continuam públicas', async () => {
    const cadastro = await post(
      '/usuarios',
      { nome: 'Novo', email: 'novo@teste.com', senha: 'segredo123' },
      null,
    );
    expect(cadastro.status).toBe(201);
    const login = await post('/auth/login', { email: 'novo@teste.com', senha: 'segredo123' }, null);
    expect(login.status).toBe(201);
    expect(typeof login.body.access_token).toBe('string');
  });

  it('CA-R4: tarefa e comentário existentes continuam com seus autores', async () => {
    await post('/tarefas', { ...tarefaBase(), idUsuarioCriador: ids.b });
    await post('/comentariostarefas', {
      comentario: 'novo',
      idTarefa: ids.tarefaExistente,
      idUsuario: ids.b,
    });
    const t = await prisma.tarefas.findUnique({ where: { id: ids.tarefaExistente } });
    const c = await prisma.comentariosTarefas.findUnique({ where: { id: ids.comentarioExistente } });
    expect(t?.idUsuarioCriador).toBe(ids.b);
    expect(c?.idUsuario).toBe(ids.b);
  });
});
