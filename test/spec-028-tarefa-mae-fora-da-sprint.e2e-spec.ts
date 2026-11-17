/**
 * SPEC-028: tarefa com sub-tarefas não entra na sprint; reabrir a tarefa reabre o item.
 *
 * CA cobertos: CA-01..CA-05 (entrego) e CA-R1 (não-regrido).
 *
 * Banco SQLite descartável, a partir das migrations. Dev com 8h todos os dias; sprint em 2027.
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
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec028-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

const TODO_DIA = { seg: 480, ter: 480, qua: 480, qui: 480, sex: 480, sab: 480, dom: 480 };

describe('SPEC-028: tarefa mãe fora da sprint', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokenAdmin: string;
  let dev: number;
  let p1: number;
  let aberto: number;
  let concluido: number;
  let cancelado: number;

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }) });
    const uAdmin = await prisma.usuarios.create({ data: { nome: 'Admin', email: 'admin@teste.com', senha: 'x', isAdmin: true } });
    dev = (await prisma.usuarios.create({ data: { nome: 'Dev', email: 'dev@teste.com', senha: 'x' } })).id;
    await prisma.jornadas.create({ data: { idUsuario: dev, vigencia: new Date('2020-01-01T00:00:00Z'), ...TODO_DIA } });
    const sp = await prisma.statusProjeto.findFirstOrThrow();
    p1 = (await prisma.projetos.create({ data: { nome: 'P1', idStatus: sp.id } })).id;
    aberto = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: false }, orderBy: { ordem: 'asc' } })).id;
    concluido = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: true }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] })).id;
    cancelado = (await prisma.statusTarefa.create({ data: { nome: 'Cancelado', ordem: 99, isFinal: true } })).id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    tokenAdmin = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: uAdmin.id, email: uAdmin.email }, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tokenAdmin}`);
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string, body: object = {}) => auth(request(server).post(url)).send(body),
      patch: (url: string, body: object) => auth(request(server).patch(url)).send(body),
    };
  };
  const tarefa = async (nome: string, idTarefaPai?: number) =>
    (await http().post('/tarefas', { nome, idStatus: aberto, prioridade: 'Média', idProjeto: p1, minutosEstimados: 480, ...(idTarefaPai && { idTarefaPai }) })).body as { id: number };
  const sprint = async () => (await http().post('/sprints', { nome: 'Sprint 1', dataInicio: '2027-03-01', dataFim: '2027-03-10' })).body as { id: number };
  const backlog = async () => ((await http().get('/tarefas?page=1&limit=100&foraDeSprint=true')).body.data as { id: number; ancestrais: { id: number }[] }[]);
  const itemDoCronograma = async (s: number, id: number) =>
    ((await http().get(`/sprints/${s}/cronograma`)).body.itens as { id: number; evolucao: number; dataEntregaReal: string | null }[]).find((i) => i.id === id)!;

  it('CA-01: tarefa com sub-tarefas → 400 e nada é criado', async () => {
    const s = await sprint();
    const mae = await tarefa('Telhado');
    await tarefa('Planejamento', mae.id);
    const r = await http().post(`/sprints/${s.id}/itens`, { idTarefa: mae.id, idUsuario: dev });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Tarefa com sub-tarefas não entra na sprint: planeje as sub-tarefas');
    expect(await prisma.itensSprint.count({ where: { idSprint: s.id } })).toBe(0);
  });

  it('CA-02: a sub-tarefa (folha) entra normalmente', async () => {
    const s = await sprint();
    const mae = await tarefa('Telhado');
    const filha = await tarefa('Planejamento', mae.id);
    expect((await http().post(`/sprints/${s.id}/itens`, { idTarefa: filha.id, idUsuario: dev })).status).toBe(201);
  });

  it('CA-03: o backlog esconde a mãe e mostra a filha com a trilha', async () => {
    const mae = await tarefa('Telhado');
    const filha = await tarefa('Planejamento', mae.id);
    const solta = await tarefa('Solta');
    const ids = (await backlog()).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([filha.id, solta.id]));
    expect(ids).not.toContain(mae.id);
    expect((await backlog()).find((t) => t.id === filha.id)!.ancestrais.map((a) => a.id)).toEqual([mae.id]);
  });

  it('CA-04: tarefa que ganha sub-tarefa depois de estar na sprint continua lá', async () => {
    const s = await sprint();
    const t = await tarefa('Forro');
    const item = (await http().post(`/sprints/${s.id}/itens`, { idTarefa: t.id, idUsuario: dev })).body as { id: number };
    expect((await http().post('/tarefas', { nome: 'Tozel', idStatus: aberto, prioridade: 'Média', idProjeto: p1, idTarefaPai: t.id })).status).toBe(201);
    expect(await prisma.itensSprint.findUnique({ where: { id: item.id } })).not.toBeNull();
  });

  it('CA-05: concluir e voltar a tarefa reabre o item (0%, sem entrega real); cancelar a partir de concluído não mexe', async () => {
    const s = await sprint();
    const a = await tarefa('A');
    const b = await tarefa('B');
    const ia = (await http().post(`/sprints/${s.id}/itens`, { idTarefa: a.id, idUsuario: dev })).body.id as number;
    const ib = (await http().post(`/sprints/${s.id}/itens`, { idTarefa: b.id, idUsuario: dev })).body.id as number;
    await http().post(`/sprints/${s.id}/ativar`);
    for (const t of [a, b]) await http().patch(`/tarefas/${t.id}`, { idStatus: concluido });
    expect(await itemDoCronograma(s.id, ia)).toMatchObject({ evolucao: 100 });

    await http().patch(`/tarefas/${a.id}`, { idStatus: aberto });
    expect(await itemDoCronograma(s.id, ia)).toMatchObject({ evolucao: 0, dataEntregaReal: null });

    await http().patch(`/tarefas/${b.id}`, { idStatus: cancelado });
    expect(await itemDoCronograma(s.id, ib)).toMatchObject({ evolucao: 100 });
    // CA-07: passar por Cancelado não escapa: sair de qualquer status final reabre
    await http().patch(`/tarefas/${b.id}`, { idStatus: aberto });
    expect(await itemDoCronograma(s.id, ib)).toMatchObject({ evolucao: 0, dataEntregaReal: null });
  });

  it('CA-08: filha não entra na sprint onde a mãe (que ganhou filhas depois) já está', async () => {
    const s = await sprint();
    const forro = await tarefa('Forro');
    await http().post(`/sprints/${s.id}/itens`, { idTarefa: forro.id, idUsuario: dev });
    const tozel = await tarefa('Tozel', forro.id);
    const r = await http().post(`/sprints/${s.id}/itens`, { idTarefa: tozel.id, idUsuario: dev });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('A tarefa mãe Forro já está nesta sprint');
  });

  it('CA-09: fechar não leva a mãe para a sprint onde a filha já está; a prévia avisa', async () => {
    const s1 = await sprint();
    const s2 = (await http().post('/sprints', { nome: 'Sprint 2', dataInicio: '2027-03-11', dataFim: '2027-03-20' })).body as { id: number };
    const forro = await tarefa('Forro');
    const item = (await http().post(`/sprints/${s1.id}/itens`, { idTarefa: forro.id, idUsuario: dev })).body.id as number;
    await http().post(`/sprints/${s1.id}/ativar`);
    const tozel = await tarefa('Tozel', forro.id);
    expect((await http().post(`/sprints/${s2.id}/itens`, { idTarefa: tozel.id, idUsuario: dev })).status).toBe(201);
    const previa = (await http().get(`/sprints/${s1.id}/fechamento`)).body.itens as { id: number; naProxima: string | null }[];
    expect(previa.find((i) => i.id === item)!.naProxima).toBe('parente');
    const r = await http().post(`/sprints/${s1.id}/fechar`, { itens: [{ id: item, destino: 'proxima' }] });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('A tarefa Forro não pode ir para a sprint Sprint 2, onde já está Tozel (mãe ou sub-tarefa dela): devolva ao backlog');
    expect((await http().post(`/sprints/${s1.id}/fechar`, { itens: [{ id: item, destino: 'backlog' }] })).status).toBe(201);
    expect(await prisma.itensSprint.count({ where: { idSprint: s2.id, idTarefa: forro.id } })).toBe(0);
  });

  it('CA-06: itens apontáveis trazem a trilha das mães e o projeto', async () => {
    const s = await sprint();
    const paredes = await tarefa('Paredes');
    const telhado = await tarefa('Telhado');
    const p = await tarefa('Planejamento', paredes.id);
    const t = await tarefa('Planejamento', telhado.id);
    for (const x of [p, t]) await http().post(`/sprints/${s.id}/itens`, { idTarefa: x.id, idUsuario: dev });
    await http().post(`/sprints/${s.id}/itens`, { idUsuario: dev, nome: 'Reuniões', minutosAvulsos: 60 });
    const r = await http().get(`/apontamentos/itens?data=2027-03-02&idUsuario=${dev}`);
    expect(r.status).toBe(200);
    const itens = r.body as { nome: string; trilha: string[]; projeto: { id: number; nome: string } | null }[];
    expect(itens.map((i) => [...i.trilha, i.nome].join(' › '))).toEqual(['Paredes › Planejamento', 'Telhado › Planejamento', 'Reuniões']);
    expect(itens.map((i) => i.projeto?.nome ?? null)).toEqual(['P1', 'P1', null]);
  });

  it('CA-R1: tarefa sem filhos segue entrando e aparecendo no backlog', async () => {
    const s = await sprint();
    const t = await tarefa('Solta');
    expect((await backlog()).map((x) => x.id)).toContain(t.id);
    expect((await http().post(`/sprints/${s.id}/itens`, { idTarefa: t.id, idUsuario: dev })).status).toBe(201);
    expect((await backlog()).map((x) => x.id)).not.toContain(t.id);
  });
});
