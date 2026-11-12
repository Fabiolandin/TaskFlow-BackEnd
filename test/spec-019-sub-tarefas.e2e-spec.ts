/**
 * SPEC-019: sub-tarefas.
 *
 * CA cobertos: CA-01..CA-08, CA-14 (entrego) e CA-R1, CA-R2 (não-regrido).
 * CA-09..CA-13 são da tela: docs/revisoes/evidencias/spec-019-verificar.mjs.
 *
 * Banco SQLite descartável, criado a cada teste a partir das migrations. O prisma/dev.db não é tocado.
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
    fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec019-')),
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

type Id = { id: number };

describe('SPEC-019: sub-tarefas', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let p1: number;
  let p2: number;
  let aberto: number;
  let final: number;

  beforeEach(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }),
    });
    const usuario = await prisma.usuarios.create({
      data: { nome: 'Teste', email: 'teste@teste.com', senha: 'x' },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    token = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: usuario.id, email: usuario.email },
      { expiresIn: '1h' },
    );
    const sp = await prisma.statusProjeto.findFirstOrThrow();
    p1 = (await prisma.projetos.create({ data: { nome: 'P1', idStatus: sp.id } })).id;
    p2 = (await prisma.projetos.create({ data: { nome: 'P2', idStatus: sp.id } })).id;
    aberto = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: false } })).id;
    final = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: true } })).id;
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string, body: object) => auth(request(server).post(url)).send(body),
      patch: (url: string, body: object) => auth(request(server).patch(url)).send(body),
      del: (url: string) => auth(request(server).delete(url)),
    };
  };

  const criar = (nome: string, extra: object = {}) =>
    http().post('/tarefas', { nome, idStatus: aberto, prioridade: 'Baixa', idProjeto: p1, ...extra });
  const contar = () => prisma.tarefas.count();

  it('CA-01/CA-08: cria sub-tarefa (e neta) com tarefaPai; a pai conta as filhas', async () => {
    const pai = (await criar('Pai')).body;
    expect(pai.tarefaPai).toBeNull();
    expect(pai.idTarefaPai).toBeNull();
    expect(pai.subtarefas).toEqual({ total: 0, concluidas: 0 });
    const sub = await criar('Sub', { idTarefaPai: pai.id });
    expect(sub.status).toBe(201);
    expect(sub.body.idTarefaPai).toBe(pai.id);
    expect(sub.body.tarefaPai).toEqual({ id: pai.id, nome: 'Pai' });
    const neta = await criar('Neta', { idTarefaPai: sub.body.id });
    expect(neta.status).toBe(201);
    expect(neta.body.tarefaPai).toEqual({ id: sub.body.id, nome: 'Sub' });
    await criar('Sub concluída', { idTarefaPai: pai.id, idStatus: final });
    const lido = (await http().get(`/tarefas/${pai.id}`)).body;
    expect(lido.subtarefas).toEqual({ total: 2, concluidas: 1 });
    const lista = (await http().get('/tarefas?limit=100')).body.data as (Id & { subtarefas: unknown })[];
    expect(lista.find((t) => t.id === pai.id)?.subtarefas).toEqual({ total: 2, concluidas: 1 });
    expect((await http().get(`/tarefas/${sub.body.id}`)).body.subtarefas).toEqual({ total: 1, concluidas: 0 });
  });

  it('CA-02: pai inexistente → 400 e nada gravado', async () => {
    const antes = await contar();
    const res = await criar('Órfã', { idTarefaPai: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Tarefa-pai inexistente: 9999');
    expect(await contar()).toBe(antes);
  });

  it('CA-03: projeto diferente do da pai → 400 e nada gravado', async () => {
    const pai = (await criar('Pai')).body;
    const antes = await contar();
    const res = await criar('Outra', { idTarefaPai: pai.id, idProjeto: p2 });
    expect(res.status).toBe(400);
    expect(typeof res.body.message).toBe('string');
    expect(await contar()).toBe(antes);
  });

  it('CA-04: PATCH com idTarefaPai não muda a pai', async () => {
    const pai = (await criar('Pai')).body;
    const outra = (await criar('Outra')).body;
    const sub = (await criar('Sub', { idTarefaPai: pai.id })).body;
    const res = await http().patch(`/tarefas/${sub.id}`, { idTarefaPai: outra.id, nome: 'Sub 2' });
    expect(res.status).toBe(200);
    expect(res.body.idTarefaPai).toBe(pai.id);
    await http().patch(`/tarefas/${outra.id}`, { idTarefaPai: pai.id });
    expect((await http().get(`/tarefas/${outra.id}`)).body.idTarefaPai).toBeNull();
  });

  it('CA-05/CA-R1: sub-tarefa e pai não mudam de projeto; o mesmo projeto passa; tarefa solta muda', async () => {
    const pai = (await criar('Pai')).body;
    const sub = (await criar('Sub', { idTarefaPai: pai.id })).body;
    for (const id of [sub.id, pai.id]) {
      const res = await http().patch(`/tarefas/${id}`, { idProjeto: p2 });
      expect(res.status).toBe(400);
      expect((await http().get(`/tarefas/${id}`)).body.idProjeto).toBe(p1);
    }
    expect((await http().patch(`/tarefas/${sub.id}`, { idProjeto: p1, nome: 'Mesmo' })).status).toBe(200);
    const solta = (await criar('Solta')).body;
    const movida = await http().patch(`/tarefas/${solta.id}`, { idProjeto: p2 });
    expect(movida.status).toBe(200);
    expect(movida.body.idProjeto).toBe(p2);
  });

  it('CA-06: excluir pai com sub-tarefas → 409; sem filhas exclui', async () => {
    const pai = (await criar('Pai')).body;
    const sub = (await criar('Sub', { idTarefaPai: pai.id })).body;
    const res = await http().del(`/tarefas/${pai.id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Tarefa em uso: tem 1 sub-tarefa(s). Exclua as sub-tarefas antes de excluir a tarefa.');
    expect(await prisma.tarefas.findUnique({ where: { id: pai.id } })).not.toBeNull();
    expect((await http().del(`/tarefas/${sub.id}`)).status).toBe(200);
    expect((await http().del(`/tarefas/${pai.id}`)).status).toBe(200);
  });

  it('CA-07: filtro idTarefaPai devolve só as filhas diretas', async () => {
    const pai = (await criar('Pai')).body;
    const a = (await criar('A', { idTarefaPai: pai.id })).body;
    const b = (await criar('B', { idTarefaPai: pai.id })).body;
    await criar('Neta', { idTarefaPai: a.id });
    await criar('Solta');
    const res = await http().get(`/tarefas?idTarefaPai=${pai.id}`);
    expect(res.status).toBe(200);
    expect((res.body.data as Id[]).map((t) => t.id)).toEqual([a.id, b.id]);
    expect(res.body.total).toBe(2);
  });

  it('CA-14: progresso do projeto e Dashboard contam a sub-tarefa', async () => {
    const pai = (await criar('Pai')).body;
    await criar('Sub', { idTarefaPai: pai.id, idStatus: final });
    const projeto = (await http().get(`/projetos/${p1}`)).body;
    expect(projeto.progresso).toEqual({ total: 2, concluidas: 1 });
    const dash = (await http().get('/dashboard')).body.tarefas;
    expect(dash.total).toBe(2);
    expect(dash.concluidas).toBe(1);
  });

  it('CA-R2: PATCH de outro campo numa sub-tarefa grava atividade', async () => {
    const pai = (await criar('Pai')).body;
    const sub = (await criar('Sub', { idTarefaPai: pai.id })).body;
    expect((await http().patch(`/tarefas/${sub.id}`, { prioridade: 'Alta' })).status).toBe(200);
    const atividades = (await http().get(`/tarefas/${sub.id}/atividades`)).body as { campo: string }[];
    expect(atividades.map((a) => a.campo)).toEqual(['prioridade']);
  });
});
