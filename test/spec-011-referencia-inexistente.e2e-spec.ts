/**
 * SPEC-011: referência inexistente em POST/PATCH responde 400 dizendo isso, e não 409
 * "não pode ser excluído"; e toda exceção do Nest chega com `message` string (D-5).
 *
 * CA cobertos: CA-B1, CA-B2, CA-B3, CA-B4, CA-B5, CA-R1, CA-R2, CA-R3, CA-R4, CA-R6,
 * CA-R7 (parte da API). CA-R5 e a parte de tela do CA-R7 são roteiro manual.
 *
 * Sobe o AppModule real (guard JWT e ValidationPipe globais) com o AllExceptionsFilter
 * registrado como no main.ts. O banco é um SQLite descartável, criado a cada teste a
 * partir das migrations do projeto. O prisma/dev.db não é tocado.
 */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const INEXISTENTE = 9999;

function criarBancoDescartavel(): string {
  const arquivo = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec011-')),
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

describe('SPEC-011: referência inexistente não é "registro em uso"', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let ids: {
    criador: number;
    naoMembro: number;
    projeto: number;
    tarefa: number;
    labelEmUso: number;
  };

  beforeEach(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }),
    });

    // Cenário: criador membro de um projeto com uma tarefa etiquetada; outro usuário
    // que não é membro. Status 1 do seed (projeto "Mapeando", tarefa "A Fazer").
    const criador = await prisma.usuarios.create({
      data: {
        nome: 'Criador',
        email: 'criador@teste.com',
        senha: await bcrypt.hash('senha-certa', 10),
      },
    });
    const naoMembro = await prisma.usuarios.create({
      data: { nome: 'Fora', email: 'fora@teste.com', senha: 'x' },
    });
    const projeto = await prisma.projetos.create({ data: { nome: 'Projeto', idStatus: 1 } });
    await prisma.usuariosProjetos.create({
      data: { idUsuario: criador.id, idProjeto: projeto.id },
    });
    const tarefa = await prisma.tarefas.create({
      data: {
        nome: 'Tarefa',
        idStatus: 1,
        prioridade: 'Alta',
        idUsuarioCriador: criador.id,
        idProjeto: projeto.id,
      },
    });
    const labelEmUso = await prisma.labels.create({ data: { nome: 'back-end' } });
    await prisma.labelsTarefas.create({ data: { idLabel: labelEmUso.id, idTarefa: tarefa.id } });

    ids = {
      criador: criador.id,
      naoMembro: naoMembro.id,
      projeto: projeto.id,
      tarefa: tarefa.id,
      labelEmUso: labelEmUso.id,
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    await app.init();

    token = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: criador.id, email: criador.email },
      { expiresIn: '1h' },
    );
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (url: string, corpo: object) =>
    request(app.getHttpServer()).post(url).set(auth()).send(corpo);
  const patch = (url: string, corpo: object) =>
    request(app.getHttpServer()).patch(url).set(auth()).send(corpo);
  const del = (url: string) => request(app.getHttpServer()).delete(url).set(auth());

  /** CA-R4: só `statusCode` e `message`, `message` string. */
  function esperaCorpo(res: request.Response, status: number) {
    expect({ status: res.status, body: res.body }).toMatchObject({
      status,
      body: { statusCode: status },
    });
    expect(Object.keys(res.body).sort()).toEqual(['message', 'statusCode']);
    expect(typeof res.body.message).toBe('string');
  }

  /** CA-B1..B4: 400 dizendo que um registro referenciado não existe, sem "excluíd". */
  function esperaReferenciaInexistente(res: request.Response) {
    esperaCorpo(res, 400);
    expect(res.body.message).toMatch(/não existe/i);
    expect(res.body.message).not.toMatch(/excluíd/i);
  }

  const tarefaValida = () => ({
    nome: 'Nova',
    idStatus: 1,
    prioridade: 'Alta',
    idProjeto: ids.projeto,
  });

  // ---------- CA-B ----------

  it('CA-B1: POST /comentariostarefas com idTarefa inexistente → 400, nada gravado', async () => {
    const antes = await prisma.comentariosTarefas.count();
    const res = await post('/comentariostarefas', { comentario: 'oi', idTarefa: INEXISTENTE });
    esperaReferenciaInexistente(res);
    expect(await prisma.comentariosTarefas.count()).toBe(antes);
  });

  it('CA-B2: POST /tarefas com idProjeto inexistente → 400, nada gravado', async () => {
    const antes = await prisma.tarefas.count();
    const res = await post('/tarefas', { ...tarefaValida(), idProjeto: INEXISTENTE });
    esperaReferenciaInexistente(res);
    expect(await prisma.tarefas.count()).toBe(antes);
  });

  it('CA-B2: POST /tarefas com idStatus inexistente → 400, mesma mensagem, nada gravado', async () => {
    const antes = await prisma.tarefas.count();
    const res = await post('/tarefas', { ...tarefaValida(), idStatus: 99 });
    esperaReferenciaInexistente(res);
    const outra = await post('/tarefas', { ...tarefaValida(), idProjeto: INEXISTENTE });
    expect(res.body.message).toBe(outra.body.message);
    expect(await prisma.tarefas.count()).toBe(antes);
  });

  it('CA-B3: PATCH /tarefas/:id com idStatus inexistente → 400, a tarefa fica como estava', async () => {
    const antes = await prisma.tarefas.findUnique({ where: { id: ids.tarefa } });
    const res = await patch(`/tarefas/${ids.tarefa}`, { idStatus: 99 });
    esperaReferenciaInexistente(res);
    expect(await prisma.tarefas.findUnique({ where: { id: ids.tarefa } })).toEqual(antes);
  });

  it('CA-B4: POST /projetos com idStatus inexistente → 400, nada gravado', async () => {
    const antes = await prisma.projetos.count();
    const res = await post('/projetos', { nome: 'Novo', idStatus: 99 });
    esperaReferenciaInexistente(res);
    expect(await prisma.projetos.count()).toBe(antes);
  });

  it('CA-B4: PATCH /projetos/:id com idStatus inexistente → 400, projeto inalterado', async () => {
    const antes = await prisma.projetos.findUnique({ where: { id: ids.projeto } });
    const res = await patch(`/projetos/${ids.projeto}`, { idStatus: 99 });
    esperaReferenciaInexistente(res);
    expect(await prisma.projetos.findUnique({ where: { id: ids.projeto } })).toEqual(antes);
  });

  it('CA-B5: NotFoundException (membro com usuário inexistente) → 404 com message string', async () => {
    const res = await post(`/projetos/${ids.projeto}/membros`, { idUsuario: INEXISTENTE });
    esperaCorpo(res, 404);
    expect(res.body.message).toBe(`Usuario ${INEXISTENTE} não encontrado`);
  });

  it('CA-B5: BadRequestException do ValidationPipe (POST /labels {}) → 400 "Validation failed"', async () => {
    const res = await post('/labels', {});
    esperaCorpo(res, 400);
    expect(res.body.message).toBe('Validation failed');
  });

  it('CA-B5 / CA-R7: login com senha errada → 401 "Credenciais inválidas" string', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'criador@teste.com', senha: 'senha-errada' });
    esperaCorpo(res, 401);
    expect(res.body.message).toBe('Credenciais inválidas');
  });

  // ---------- CA-R ----------

  it('CA-R1: DELETE de label, projeto, usuário e status em uso continuam 409 "Registro em uso"', async () => {
    // Desde a SPEC-013 (RF-30), usuário membro é recusado antes, com a mensagem "membro de N projeto(s)".
    // Para exercitar o ramo P2003, o criador sai do projeto e fica preso só pela tarefa que criou.
    await prisma.usuariosProjetos.deleteMany({ where: { idUsuario: ids.criador } });
    for (const url of [
      `/labels/${ids.labelEmUso}`,
      `/projetos/${ids.projeto}`,
      `/usuarios/${ids.criador}`,
      '/statusprojeto/1',
      '/statustarefa/1',
    ]) {
      const res = await del(url);
      esperaCorpo(res, 409);
      expect(res.body.message).toMatch(/^Registro em uso: /);
    }
  });

  it('CA-R2: P2025 continua 404 "Registro não encontrado"', async () => {
    const res = await del(`/labels/${INEXISTENTE}`);
    esperaCorpo(res, 404);
    expect(res.body.message).toBe('Registro não encontrado');
  });

  it('CA-R3: responsável não membro continua 400 com a mensagem da regra', async () => {
    const res = await post('/tarefas', { ...tarefaValida(), idUsuarioResponsavel: ids.naoMembro });
    esperaCorpo(res, 400);
    expect(res.body.message).toBe('O responsável precisa ser membro do projeto da tarefa');
  });

  it('CA-R3: membro repetido continua 409 com a mensagem própria', async () => {
    const res = await post(`/projetos/${ids.projeto}/membros`, { idUsuario: ids.criador });
    esperaCorpo(res, 409);
    expect(res.body.message).toBe('O usuário já é membro deste projeto');
  });

  it('CA-R6: email duplicado em POST /usuarios continua 409 com message string', async () => {
    const res = await request(app.getHttpServer())
      .post('/usuarios')
      .send({ nome: 'Repetido', email: 'fora@teste.com', senha: '123456' });
    esperaCorpo(res, 409);
    expect(res.body.message).toMatch(/email/i);
  });

  it('CA-R7: rota protegida sem token continua 401', async () => {
    const res = await request(app.getHttpServer()).get('/labels');
    expect(res.status).toBe(401);
    expect(res.body.statusCode).toBe(401);
  });
});
