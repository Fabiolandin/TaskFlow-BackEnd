/**
 * SPEC-026: apontamento de horas.
 *
 * CA cobertos: CA-01..CA-17 (entrego) e CA-R1 (não-regrido).
 * CA-21 é da função pura: src/apontamentos/horario.logica.spec.ts. CA-18..CA-20: spec-026-verificar.mjs.
 *
 * Banco SQLite descartável, a partir das migrations. Sprint de março/2027 ativa (dev com itens A e B);
 * sprint de abril/2027 em planejamento (item C do dev); sprint de maio/2027 fechada (item D do dev).
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
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec026-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}
const TODO_DIA = { seg: 480, ter: 480, qua: 480, qui: 480, sex: 480, sab: 480, dom: 480 };
const MARCO = '2027-03-02';

describe('SPEC-026: apontamento de horas', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokenAdmin: string;
  let tokenComum: string;
  let tokenDev: string;
  let tokenDev2: string;
  let comum: number;
  let dev: number;
  let dev2: number;
  let p1: number;
  let marco: number;
  let itemA: number;
  let itemB: number;
  let itemC: number;
  let itemD: number;
  let itemDev2: number;

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }) });
    const cria = (nome: string, isAdmin = false) => prisma.usuarios.create({ data: { nome, email: `${nome.toLowerCase()}@teste.com`, senha: 'x', isAdmin } });
    const [uAdmin, uComum, uDev, uDev2] = [await cria('Admin', true), await cria('Comum'), await cria('Dev'), await cria('Dev2')];
    [comum, dev, dev2] = [uComum.id, uDev.id, uDev2.id];
    for (const u of [dev, dev2]) await prisma.jornadas.create({ data: { idUsuario: u, vigencia: new Date('2020-01-01T00:00:00Z'), ...TODO_DIA } });
    const sp = await prisma.statusProjeto.findFirstOrThrow();
    p1 = (await prisma.projetos.create({ data: { nome: 'P1', idStatus: sp.id } })).id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = (u: { id: number; email: string }) => jwt.sign({ sub: u.id, email: u.email }, { expiresIn: '1h' });
    [tokenAdmin, tokenComum, tokenDev, tokenDev2] = [token(uAdmin), token(uComum), token(uDev), token(uDev2)];

    const aberto = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: false }, orderBy: { ordem: 'asc' } })).id;
    const tarefa = async (nome: string) => (await http().post('/tarefas', { nome, idStatus: aberto, prioridade: 'Média', idProjeto: p1, minutosEstimados: 120 })).body.id as number;
    const sprint = async (nome: string, de: string, ate: string) => (await http().post('/sprints', { nome, dataInicio: de, dataFim: ate })).body.id as number;
    const alocar = async (s: number, nome: string, u = dev) => (await http().post(`/sprints/${s}/itens`, { idTarefa: await tarefa(nome), idUsuario: u })).body.id as number;
    marco = await sprint('Março', '2027-03-01', '2027-03-10');
    itemA = await alocar(marco, 'A');
    itemB = await alocar(marco, 'B');
    itemDev2 = await alocar(marco, 'X', dev2);
    await http().post(`/sprints/${marco}/ativar`);
    const abril = await sprint('Abril', '2027-04-01', '2027-04-10');
    itemC = await alocar(abril, 'C');
    const maio = await sprint('Maio', '2027-05-01', '2027-05-10');
    itemD = await alocar(maio, 'D');
    await prisma.sprints.update({ where: { id: maio }, data: { status: 'Fechada' } });
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = (token = tokenAdmin) => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string, body: object = {}) => auth(request(server).post(url)).send(body),
      patch: (url: string, body: object) => auth(request(server).patch(url)).send(body),
      del: (url: string) => auth(request(server).delete(url)),
    };
  };
  const apontar = (dados: object, token = tokenDev) => http(token).post('/apontamentos', { data: MARCO, ...dados });

  it('CA-01: 08:00–09:20 com item da sprint da data → 80 minutos', async () => {
    const r = await apontar({ inicio: '08:00', fim: '09:20', idItemSprint: itemA });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ idUsuario: dev, data: MARCO, inicio: '08:00', fim: '09:20', minutos: 80, idItemSprint: itemA, foraDaSprint: false });
    expect(r.body.item).toMatchObject({ id: itemA, nome: 'A', sprint: { id: marco, nome: 'Março' } });
  });

  it('CA-02: fim igual ou antes do início, ou hora inválida → 400', async () => {
    const r = await apontar({ inicio: '09:00', fim: '09:00', idItemSprint: itemA });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('A hora de fim precisa ser maior que a de início');
    expect((await apontar({ inicio: '10:00', fim: '09:00', idItemSprint: itemA })).status).toBe(400);
    expect((await apontar({ inicio: '23:00', fim: '24:00', idItemSprint: itemA })).status).toBe(400);
    expect((await apontar({ inicio: '8:0', fim: '09:00', idItemSprint: itemA })).status).toBe(400);
    expect(await prisma.apontamentos.count()).toBe(0);
  });

  it('CA-03: sobreposição do mesmo dev → 409; encostar pode; outro dev no mesmo horário pode', async () => {
    await apontar({ inicio: '08:00', fim: '09:20', idItemSprint: itemA });
    const r = await apontar({ inicio: '09:00', fim: '10:00', idItemSprint: itemB });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('O horário se sobrepõe ao apontamento das 08:00 às 09:20');
    expect((await apontar({ inicio: '09:20', fim: '10:00', idItemSprint: itemB })).status).toBe(201);
    expect((await apontar({ inicio: '08:00', fim: '09:20', idItemSprint: itemDev2 }, tokenDev2)).status).toBe(201);
  });

  it('CA-04: sem item exige observação', async () => {
    const r = await apontar({ inicio: '08:00', fim: '09:00' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Apontamento sem tarefa precisa de observação');
    expect((await apontar({ inicio: '08:00', fim: '09:00', observacao: '   ' })).status).toBe(400);
    const ok = await apontar({ inicio: '08:00', fim: '09:00', observacao: 'Suporte ao cliente' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ idItemSprint: null, item: null, observacao: 'Suporte ao cliente' });
  });

  it('CA-05: item de outro dev → 400; item de sprint fechada → 409', async () => {
    const r = await apontar({ inicio: '08:00', fim: '09:00', idItemSprint: itemDev2 });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('O item não é deste dev');
    const f = await apontar({ data: '2027-05-02', inicio: '08:00', fim: '09:00', idItemSprint: itemD });
    expect(f.status).toBe(409);
    expect(f.body.message).toBe('Sprint fechada');
  });

  it('CA-06: item de outra sprint só com foraDaSprint, e fica marcado', async () => {
    const r = await apontar({ inicio: '08:00', fim: '09:00', idItemSprint: itemC });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('O item não é da sprint desta data');
    const ok = await apontar({ inicio: '08:00', fim: '09:00', idItemSprint: itemC, foraDaSprint: true });
    expect(ok.status).toBe(201);
    expect(ok.body.foraDaSprint).toBe(true);
    // item da própria sprint da data não fica marcado, mesmo com a opção
    expect((await apontar({ inicio: '10:00', fim: '11:00', idItemSprint: itemA, foraDaSprint: true })).body.foraDaSprint).toBe(false);
  });

  it('CA-07: data fora de sprint é aceita com alerta', async () => {
    const r = await apontar({ data: '2027-06-15', inicio: '08:00', fim: '09:00', observacao: 'Estudo' });
    expect(r.status).toBe(201);
    expect(r.body.alerta).toBe('A data não está em nenhuma sprint');
    expect((await apontar({ inicio: '08:00', fim: '09:00', observacao: 'X' })).body.alerta).toBeUndefined();
  });

  it('CA-08: o dia em ordem, com total e início sugerido', async () => {
    await apontar({ inicio: '10:00', fim: '11:30', idItemSprint: itemB });
    await apontar({ inicio: '08:00', fim: '09:20', idItemSprint: itemA });
    const r = await http(tokenDev).get(`/apontamentos?data=${MARCO}`);
    expect(r.status).toBe(200);
    expect(r.body.apontamentos.map((a: { inicio: string }) => a.inicio)).toEqual(['08:00', '10:00']);
    expect(r.body).toMatchObject({ data: MARCO, sprint: { id: marco, nome: 'Março' }, totalMinutos: 170, sugestaoInicio: '11:30' });
    const vazio = await http(tokenDev).get('/apontamentos?data=2027-03-03');
    expect(vazio.body).toMatchObject({ apontamentos: [], totalMinutos: 0, sugestaoInicio: null });
  });

  it('CA-09: não admin não aponta nem lê por outro', async () => {
    const r = await apontar({ inicio: '08:00', fim: '09:00', observacao: 'X', idUsuario: dev }, tokenComum);
    expect(r.status).toBe(403);
    expect(r.body.message).toBe('Você só aponta as suas horas');
    expect((await http(tokenComum).get(`/apontamentos?data=${MARCO}&idUsuario=${dev}`)).status).toBe(403);
  });

  it('CA-10: só o dono ou admin editam e excluem', async () => {
    const a = (await apontar({ inicio: '08:00', fim: '09:00', idItemSprint: itemA })).body;
    expect((await http(tokenComum).patch(`/apontamentos/${a.id}`, { fim: '09:30' })).status).toBe(403);
    expect((await http(tokenComum).del(`/apontamentos/${a.id}`)).status).toBe(403);
    const r = await http().patch(`/apontamentos/${a.id}`, { fim: '09:30' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ fim: '09:30', minutos: 90 });
    expect((await http(tokenDev).del(`/apontamentos/${a.id}`)).status).toBe(200);
    expect(await prisma.apontamentos.count()).toBe(0);
  });

  it('CA-11: admin lança para outro dev', async () => {
    const r = await apontar({ inicio: '08:00', fim: '09:00', idItemSprint: itemA, idUsuario: dev }, tokenAdmin);
    expect(r.status).toBe(201);
    expect(r.body.idUsuario).toBe(dev);
    expect((await http().get(`/apontamentos?data=${MARCO}&idUsuario=${dev}`)).body.apontamentos).toHaveLength(1);
  });

  it('CA-12: itens selecionáveis: só os da sprint da data; com todas, os de sprints não fechadas', async () => {
    const r = await http(tokenDev).get(`/apontamentos/itens?data=${MARCO}`);
    expect(r.status).toBe(200);
    expect(r.body.map((i: { id: number }) => i.id).sort()).toEqual([itemA, itemB].sort());
    const todas = await http(tokenDev).get(`/apontamentos/itens?data=${MARCO}&todas=true`);
    expect(todas.body.map((i: { id: number }) => i.id).sort()).toEqual([itemA, itemB, itemC].sort());
    expect(todas.body.find((i: { id: number }) => i.id === itemC).sprint).toMatchObject({ nome: 'Abril' });
  });

  it('CA-13: converter cria a tarefa, o item não previsto e liga o apontamento', async () => {
    const a = (await apontar({ inicio: '14:00', fim: '15:00', observacao: 'Reunião com cliente X' })).body;
    const r = await http(tokenDev).post(`/apontamentos/${a.id}/converter`, { idProjeto: p1 });
    expect(r.status).toBe(201);
    expect(r.body.item).toMatchObject({ nome: 'Reunião com cliente X', sprint: { id: marco } });
    const item = await prisma.itensSprint.findUniqueOrThrow({ where: { id: r.body.idItemSprint }, include: { tarefa: true } });
    expect(item).toMatchObject({ idSprint: marco, idUsuario: dev, naoPrevista: true });
    expect(item.tarefa).toMatchObject({ nome: 'Reunião com cliente X', idProjeto: p1, idUsuarioResponsavel: dev, prioridade: 'Média' });
  });

  it('CA-14: converter com item → 400; sem sprint na data → 409', async () => {
    const comItem = (await apontar({ inicio: '08:00', fim: '09:00', idItemSprint: itemA })).body;
    expect((await http(tokenDev).post(`/apontamentos/${comItem.id}/converter`, { idProjeto: p1 })).status).toBe(400);
    const fora = (await apontar({ data: '2027-06-15', inicio: '08:00', fim: '09:00', observacao: 'X' })).body;
    const r = await http(tokenDev).post(`/apontamentos/${fora.id}/converter`, { idProjeto: p1 });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('A data não está em nenhuma sprint');
  });

  it('CA-15: item removido deixa os apontamentos sem item, com a observação', async () => {
    await apontar({ inicio: '08:00', fim: '09:00', idItemSprint: itemA });
    await apontar({ inicio: '09:00', fim: '10:00', idItemSprint: itemA, observacao: 'já tinha' });
    expect((await http().del(`/itens/${itemA}`)).status).toBe(204);
    const lista = await prisma.apontamentos.findMany({ orderBy: { inicioMin: 'asc' } });
    expect(lista.map((x) => [x.idItemSprint, x.observacao])).toEqual([[null, 'Item removido: A'], [null, 'já tinha']]);
  });

  it('CA-16: o cronograma soma as apontadas, calcula o consumo e marca Em andamento', async () => {
    await apontar({ inicio: '08:00', fim: '09:30', idItemSprint: itemA });
    await apontar({ inicio: '10:00', fim: '11:30', idItemSprint: itemA });
    const linha = (await http().get(`/sprints/${marco}/cronograma`)).body.itens.find((i: { id: number }) => i.id === itemA);
    expect(linha).toMatchObject({ apontadas: 180, consumo: 150, evolucao: 0, status: 'Em andamento' });
  });

  it('CA-17: usuário com apontamento não é excluído', async () => {
    await apontar({ inicio: '08:00', fim: '09:00', observacao: 'X' }, tokenComum);
    const r = await http().del(`/usuarios/${comum}`);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Usuário em uso: tem apontamentos');
  });

  it('CA-R1: planejamento e ativação seguem respondendo', async () => {
    expect((await http().get(`/sprints/${marco}/planejamento`)).status).toBe(200);
  });
});
