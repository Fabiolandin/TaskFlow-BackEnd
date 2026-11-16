/**
 * SPEC-027: fechamento da sprint.
 *
 * CA cobertos: CA-01..CA-10 (entrego) e CA-R1 (não-regrido). CA-11, CA-12: spec-027-verificar.mjs.
 *
 * Banco descartável. Dev com 8h todos os dias. Sprint 1 (01–05/03/2027) ativa com A, B, C (8h cada) e a linha
 * recorrente "Reuniões" (4h); A a 100%, B a 25%, C a 0%, Reuniões a 50%.
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
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec027-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}
const TODO_DIA = { seg: 480, ter: 480, qua: 480, qui: 480, sex: 480, sab: 480, dom: 480 };

describe('SPEC-027: fechamento da sprint', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokenAdmin: string;
  let tokenComum: string;
  let tokenDev: string;
  let dev: number;
  let p1: number;
  let aberto: number;
  let s1: number;
  let itemA: number;
  let itemB: number;
  let itemC: number;
  let tarefaB: number;
  let tarefaC: number;

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }) });
    const cria = (nome: string, isAdmin = false) => prisma.usuarios.create({ data: { nome, email: `${nome.toLowerCase()}@teste.com`, senha: 'x', isAdmin } });
    const [uAdmin, uComum, uDev] = [await cria('Admin', true), await cria('Comum'), await cria('Dev')];
    dev = uDev.id;
    await prisma.jornadas.create({ data: { idUsuario: dev, vigencia: new Date('2020-01-01T00:00:00Z'), ...TODO_DIA } });
    const sp = await prisma.statusProjeto.findFirstOrThrow();
    p1 = (await prisma.projetos.create({ data: { nome: 'P1', idStatus: sp.id } })).id;
    aberto = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: false }, orderBy: { ordem: 'asc' } })).id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = (u: { id: number; email: string }) => jwt.sign({ sub: u.id, email: u.email }, { expiresIn: '1h' });
    [tokenAdmin, tokenComum, tokenDev] = [token(uAdmin), token(uComum), token(uDev)];

    s1 = (await http().post('/sprints', { nome: 'Sprint 1', dataInicio: '2027-03-01', dataFim: '2027-03-05' })).body.id;
    const alocar = async (nome: string) => {
      const t = (await http().post('/tarefas', { nome, idStatus: aberto, prioridade: 'Média', idProjeto: p1, minutosEstimados: 480 })).body.id as number;
      return { t, item: (await http().post(`/sprints/${s1}/itens`, { idTarefa: t, idUsuario: dev })).body.id as number };
    };
    itemA = (await alocar('A')).item;
    ({ t: tarefaB, item: itemB } = await alocar('B'));
    ({ t: tarefaC, item: itemC } = await alocar('C'));
    const reunioes = (await http().post(`/sprints/${s1}/itens`, { nome: 'Reuniões', minutosAvulsos: 240, recorrente: true, idUsuario: dev })).body.id;
    await http().post(`/sprints/${s1}/ativar`);
    await http(tokenDev).patch(`/itens/${itemA}/acompanhamento`, { evolucao: 100 });
    await http(tokenDev).patch(`/itens/${itemB}/acompanhamento`, { evolucao: 25 });
    await http(tokenDev).patch(`/itens/${reunioes}/acompanhamento`, { evolucao: 50 });
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
      put: (url: string, body: object) => auth(request(server).put(url)).send(body),
      del: (url: string) => auth(request(server).delete(url)),
    };
  };
  const fechar = (itens: { id: number; destino: string }[], token = tokenAdmin, sprint = () => s1) => http(token).post(`/sprints/${sprint()}/fechar`, { itens });
  const padrao = () => [{ id: itemB, destino: 'proxima' }, { id: itemC, destino: 'backlog' }];

  it('CA-01: a prévia lista só as tarefas abaixo de 100%, com as horas restantes', async () => {
    const r = await http(tokenComum).get(`/sprints/${s1}/fechamento`);
    expect(r.status).toBe(200);
    expect(r.body.itens.map((i: { id: number; restantes: number; evolucao: number }) => [i.id, i.evolucao, i.restantes])).toEqual([[itemB, 25, 360], [itemC, 0, 480]]);
    expect(r.body.itens[0].tarefa.nome).toBe('B');
    expect(r.body.proxima).toEqual({ id: null, nome: 'Sprint 2' });
  });

  it('CA-02: não admin não fecha', async () => {
    const r = await fechar(padrao(), tokenComum);
    expect(r.status).toBe(403);
    expect((await prisma.sprints.findUniqueOrThrow({ where: { id: s1 } })).status).toBe('Ativa');
  });

  it('CA-03: só sprint ativa fecha; a lista precisa trazer todas as não concluídas', async () => {
    const outra = (await http().post('/sprints', { nome: 'Outra', dataInicio: '2027-06-01', dataFim: '2027-06-05' })).body.id;
    const r = await fechar([], tokenAdmin, () => outra);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Só sprint ativa pode ser fechada');
    const incompleta = await fechar([{ id: itemB, destino: 'proxima' }]);
    expect(incompleta.status).toBe(400);
    expect(incompleta.body.message).toBe('Escolha o destino de todas as tarefas não concluídas');
    expect((await fechar([...padrao(), { id: itemA, destino: 'proxima' }])).status).toBe(400);
    expect((await fechar([{ id: itemB, destino: 'lixo' }, { id: itemC, destino: 'backlog' }])).status).toBe(400);
  });

  it('CA-04/CA-05: fecha; o original fica como histórico; a próxima recebe as horas restantes no topo', async () => {
    const r = await fechar(padrao());
    expect(r.status).toBe(201);
    expect(r.body.sprint.status).toBe('Fechada');
    const original = await prisma.itensSprint.findUniqueOrThrow({ where: { id: itemB } });
    expect(original).toMatchObject({ idSprint: s1, evolucao: 25 });
    const s2 = await prisma.sprints.findFirstOrThrow({ where: { nome: 'Sprint 2' } });
    const fila = await prisma.itensSprint.findMany({ where: { idSprint: s2.id, idUsuario: dev }, orderBy: { ordem: 'asc' } });
    expect(fila[0]).toMatchObject({ idTarefa: tarefaB, minutosPlanejadosFixos: 360, idItemOrigem: itemB, evolucao: 0, ordem: 1 });
  });

  it('CA-06: devolver ao backlog não cria nada; a tarefa volta ao backlog', async () => {
    await fechar(padrao());
    expect(await prisma.itensSprint.count({ where: { idTarefa: tarefaC } })).toBe(1);
    const backlog = (await http().get('/tarefas?foraDeSprint=true&limit=100')).body.data.map((t: { id: number }) => t.id);
    expect(backlog).toContain(tarefaC);
    expect(backlog).not.toContain(tarefaB);
  });

  it('CA-07: sem próxima sprint, ela é criada com a mesma duração e os recorrentes', async () => {
    const r = await fechar(padrao());
    expect(r.body.proxima).toMatchObject({ nome: 'Sprint 2' });
    const s2 = await prisma.sprints.findFirstOrThrow({ where: { nome: 'Sprint 2' } });
    expect([s2.dataInicio.toISOString().slice(0, 10), s2.dataFim.toISOString().slice(0, 10), s2.status]).toEqual(['2027-03-06', '2027-03-10', 'Planejamento']);
    const fila = await prisma.itensSprint.findMany({ where: { idSprint: s2.id }, orderBy: { ordem: 'asc' }, include: { tarefa: true } });
    expect(fila.map((i) => i.tarefa?.nome ?? i.nome)).toEqual(['B', 'Reuniões']);
  });

  it('CA-08: tarefa que já está na próxima → 409 e nada muda', async () => {
    const s2 = (await http().post('/sprints', { nome: 'Sprint 2', dataInicio: '2027-03-06', dataFim: '2027-03-10' })).body.id;
    await http().post(`/sprints/${s2}/itens`, { idTarefa: tarefaB, idUsuario: dev });
    const r = await fechar(padrao());
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('A tarefa B já está na sprint Sprint 2');
    expect((await prisma.sprints.findUniqueOrThrow({ where: { id: s1 } })).status).toBe('Ativa');
  });

  it('CA-09: sprint fechada é somente leitura', async () => {
    await fechar(padrao());
    const t = (await http().post('/tarefas', { nome: 'Nova', idStatus: aberto, prioridade: 'Média', idProjeto: p1 })).body.id;
    const esperar409 = async (r: request.Response) => { expect(r.status).toBe(409); expect(r.body.message).toBe('Sprint fechada'); };
    await esperar409(await http().post(`/sprints/${s1}/itens`, { idTarefa: t, idUsuario: dev }));
    await esperar409(await http().patch(`/itens/${itemB}`, { posicao: 1 }));
    await esperar409(await http().del(`/itens/${itemB}`));
    await esperar409(await http().patch(`/sprints/${s1}`, { nome: 'X' }));
    await esperar409(await http(tokenDev).patch(`/itens/${itemB}/acompanhamento`, { evolucao: 50 }));
    await esperar409(await http(tokenDev).post('/apontamentos', { data: '2027-03-02', inicio: '08:00', fim: '09:00', idItemSprint: itemB }));
    expect((await http().put(`/sprints/${s1}/fila/${dev}`, { ids: [itemA, itemB, itemC] })).status).toBe(409);
  });

  it('CA-10: depois de fechar, outra sprint pode ser ativada', async () => {
    await fechar(padrao());
    const s2 = await prisma.sprints.findFirstOrThrow({ where: { nome: 'Sprint 2' } });
    const r = await http().post(`/sprints/${s2.id}/ativar`);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('Ativa');
  });

  it('CA-R1: cronograma da sprint fechada segue legível', async () => {
    await fechar(padrao());
    const r = await http().get(`/sprints/${s1}/cronograma`);
    expect(r.status).toBe(200);
    expect(r.body.itens.find((i: { id: number }) => i.id === itemB)).toMatchObject({ evolucao: 25 });
  });
});
