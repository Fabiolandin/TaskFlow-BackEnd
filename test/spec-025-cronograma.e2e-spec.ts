/**
 * SPEC-025: cronograma, acompanhamento, status derivado e sincronia com o status da tarefa.
 *
 * CA cobertos: CA-01..CA-07, CA-18..CA-20 (entrego) e CA-R1, CA-R2 (não-regrido).
 * CA-08..CA-17, CA-26 são da função pura: src/sprints/acompanhamento.logica.spec.ts.
 * CA-21..CA-25 são da tela: docs/revisoes/evidencias/spec-025-verificar.mjs.
 *
 * Banco SQLite descartável, a partir das migrations. Devs com 8h todos os dias; sprints em 2027.
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
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec025-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

const TODO_DIA = { seg: 480, ter: 480, qua: 480, qui: 480, sex: 480, sab: 480, dom: 480 };
const h = (horas: number) => horas * 60;
const hoje = () => new Date().toISOString().slice(0, 10);

type ItemCronograma = {
  id: number; tipo: string; tarefa: { id: number; nome: string; status: { id: number } } | null; avulso: { nome: string } | null;
  usuario: { id: number }; projeto: { id: number; nome: string } | null; naoPrevista: boolean; planejadas: number; apontadas: number;
  consumo: number | null; restantes: number; evolucao: number; status: string; bloqueio: string | null; observacao: string | null;
  dataEntregaReal: string | null; inicioPrevisto: string | null; entregaPrevista: string | null; diasUteis: number | null;
  inicioProjetado: string | null; entregaProjetada: string | null; atraso: number | null; risco: boolean;
};

describe('SPEC-025: cronograma e acompanhamento', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokenAdmin: string;
  let tokenComum: string;
  let tokenDev: string;
  let dev: number;
  let dev2: number;
  let p1: number;
  let p2: number;
  let aberto: number;
  let concluido: number;
  let cancelado: number;

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }) });
    const cria = (nome: string, isAdmin = false) => prisma.usuarios.create({ data: { nome, email: `${nome.toLowerCase()}@teste.com`, senha: 'x', isAdmin } });
    const [uAdmin, uComum, uDev, uDev2] = [await cria('Admin', true), await cria('Comum'), await cria('Dev'), await cria('Dev2')];
    [dev, dev2] = [uDev.id, uDev2.id];
    for (const u of [dev, dev2]) await prisma.jornadas.create({ data: { idUsuario: u, vigencia: new Date('2020-01-01T00:00:00Z'), ...TODO_DIA } });
    const sp = await prisma.statusProjeto.findFirstOrThrow();
    p1 = (await prisma.projetos.create({ data: { nome: 'P1', idStatus: sp.id } })).id;
    p2 = (await prisma.projetos.create({ data: { nome: 'P2', idStatus: sp.id } })).id;
    aberto = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: false }, orderBy: { ordem: 'asc' } })).id;
    concluido = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: true }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] })).id;
    cancelado = (await prisma.statusTarefa.create({ data: { nome: 'Cancelado', ordem: 99, isFinal: true } })).id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = (u: { id: number; email: string }) => jwt.sign({ sub: u.id, email: u.email }, { expiresIn: '1h' });
    [tokenAdmin, tokenComum, tokenDev] = [token(uAdmin), token(uComum), token(uDev)];
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
    };
  };
  const tarefa = async (nome: string, horas: number, idProjeto = p1) =>
    (await http().post('/tarefas', { nome, idStatus: aberto, prioridade: 'Média', idProjeto, minutosEstimados: h(horas) })).body as { id: number };
  const sprintAtiva = async (itens: { nome: string; horas: number; usuario?: number; projeto?: number }[]) => {
    const s = (await http().post('/sprints', { nome: 'Sprint 1', dataInicio: '2027-03-01', dataFim: '2027-03-10' })).body as { id: number };
    const ids: number[] = [];
    for (const i of itens) {
      const t = await tarefa(i.nome, i.horas, i.projeto ?? p1);
      ids.push((await http().post(`/sprints/${s.id}/itens`, { idTarefa: t.id, idUsuario: i.usuario ?? dev })).body.id);
    }
    await http().post(`/sprints/${s.id}/ativar`);
    return { sprint: s.id, itens: ids };
  };
  const acompanhar = (id: number, dados: object, token = tokenDev) => http(token).patch(`/itens/${id}/acompanhamento`, dados);
  const cronograma = async (sprint: number, filtro = '') => (await http().get(`/sprints/${sprint}/cronograma${filtro}`)).body as {
    evolucao: { sprint: number | null; porDev: { usuario: { id: number }; evolucao: number | null }[]; porProjeto: { projeto: { id: number }; evolucao: number | null }[] };
    itens: ItemCronograma[];
  };
  const item = async (sprint: number, id: number) => (await cronograma(sprint)).itens.find((i) => i.id === id)!;

  it('CA-01: o dev do item grava evolução, bloqueio e observação', async () => {
    const { sprint, itens } = await sprintAtiva([{ nome: 'A', horas: 8 }]);
    const r = await acompanhar(itens[0], { evolucao: 50, bloqueio: 'aguardando API', observacao: 'Liberado para homologação' });
    expect(r.status).toBe(200);
    expect(await item(sprint, itens[0])).toMatchObject({ evolucao: 50, bloqueio: 'aguardando API', observacao: 'Liberado para homologação', status: 'Bloqueada' });
    await acompanhar(itens[0], { bloqueio: '' });
    expect(await item(sprint, itens[0])).toMatchObject({ bloqueio: null, status: 'Em andamento' });
  });

  it('CA-02: evolução fora de 0..100 ou não inteira → 400', async () => {
    const { itens } = await sprintAtiva([{ nome: 'A', horas: 8 }]);
    for (const evolucao of [-1, 101, 50.5, '50']) expect((await acompanhar(itens[0], { evolucao })).status).toBe(400);
  });

  it('CA-03/CA-04: admin grava; outro usuário → 403; sprint fechada → 409', async () => {
    const { sprint, itens } = await sprintAtiva([{ nome: 'A', horas: 8 }]);
    expect((await acompanhar(itens[0], { evolucao: 10 }, tokenAdmin)).status).toBe(200);
    const r = await acompanhar(itens[0], { evolucao: 20 }, tokenComum);
    expect(r.status).toBe(403);
    expect(r.body.message).toBe('Só o dev do item ou o administrador atualizam o acompanhamento');
    await prisma.sprints.update({ where: { id: sprint }, data: { status: 'Fechada' } });
    const f = await acompanhar(itens[0], { evolucao: 30 });
    expect(f.status).toBe(409);
    expect(f.body.message).toBe('Sprint fechada');
  });

  it('CA-05: 100% preenche a entrega real com hoje; sair de 100 limpa; a data enviada vale', async () => {
    const { sprint, itens } = await sprintAtiva([{ nome: 'A', horas: 8 }]);
    await acompanhar(itens[0], { evolucao: 100 });
    expect((await item(sprint, itens[0])).dataEntregaReal).toBe(hoje());
    await acompanhar(itens[0], { evolucao: 80 });
    expect((await item(sprint, itens[0])).dataEntregaReal).toBeNull();
    await acompanhar(itens[0], { evolucao: 100, dataEntregaReal: '2027-03-03' });
    expect((await item(sprint, itens[0])).dataEntregaReal).toBe('2027-03-03');
  });

  it('CA-06: 100% conclui a tarefa com atividade; voltar não reabre; tarefa cancelada não muda', async () => {
    const { sprint, itens } = await sprintAtiva([{ nome: 'A', horas: 8 }, { nome: 'B', horas: 8 }]);
    const [a, b] = (await cronograma(sprint)).itens;
    await acompanhar(itens[0], { evolucao: 100 });
    expect((await http().get(`/tarefas/${a.tarefa!.id}`)).body.idStatus).toBe(concluido);
    const atividades = (await http().get(`/tarefas/${a.tarefa!.id}/atividades`)).body as { campo: string; idNovo: number; autor: { id: number } }[];
    expect(atividades.find((x) => x.campo === 'status')).toMatchObject({ idNovo: concluido, autor: { id: dev } });
    await acompanhar(itens[0], { evolucao: 80 });
    expect((await http().get(`/tarefas/${a.tarefa!.id}`)).body.idStatus).toBe(concluido);
    await http().patch(`/tarefas/${b.tarefa!.id}`, { idStatus: cancelado });
    await acompanhar(itens[1], { evolucao: 100 });
    expect((await http().get(`/tarefas/${b.tarefa!.id}`)).body.idStatus).toBe(cancelado);
  });

  it('CA-07: concluir a tarefa leva o item a 100%; cancelar não mexe', async () => {
    const { sprint, itens } = await sprintAtiva([{ nome: 'A', horas: 8 }, { nome: 'B', horas: 8 }]);
    const [a, b] = (await cronograma(sprint)).itens;
    await acompanhar(itens[0], { evolucao: 40 });
    await http().patch(`/tarefas/${a.tarefa!.id}`, { idStatus: concluido });
    expect(await item(sprint, itens[0])).toMatchObject({ evolucao: 100, status: 'Concluída', dataEntregaReal: hoje() });
    await acompanhar(itens[1], { evolucao: 40 });
    await http().patch(`/tarefas/${b.tarefa!.id}`, { idStatus: cancelado });
    expect((await item(sprint, itens[1])).evolucao).toBe(40);
  });

  it('CA-18: o cronograma traz os campos e a ordem dev → fila', async () => {
    const { sprint, itens } = await sprintAtiva([
      { nome: 'A', horas: 8 }, { nome: 'B', horas: 4, usuario: dev2 }, { nome: 'C', horas: 2 },
    ]);
    const c = await cronograma(sprint);
    expect(c.itens.map((i) => i.tarefa!.nome)).toEqual(['A', 'C', 'B']);
    expect(c.itens[0]).toMatchObject({
      id: itens[0], tipo: 'tarefa', usuario: { id: dev }, projeto: { id: p1, nome: 'P1' }, naoPrevista: false, planejadas: h(8), apontadas: 0,
      consumo: 0, restantes: h(8), evolucao: 0, status: 'Não iniciada', bloqueio: null, observacao: null, dataEntregaReal: null,
      inicioPrevisto: '2027-03-01', entregaPrevista: '2027-03-01', diasUteis: 1, inicioProjetado: '2027-03-01', entregaProjetada: '2027-03-01',
      atraso: null, risco: false,
    });
    expect(c.evolucao.sprint).toBe(0);
  });

  it('CA-19: filtros recortam itens e evoluções por dev/projeto; a da sprint não muda', async () => {
    const { sprint, itens } = await sprintAtiva([
      { nome: 'A', horas: 8 }, { nome: 'B', horas: 2, usuario: dev2, projeto: p2 },
    ]);
    await acompanhar(itens[0], { evolucao: 100 });
    const tudo = await cronograma(sprint);
    expect(tudo.evolucao.sprint).toBe(80);
    expect(tudo.evolucao.porDev.map((d) => [d.usuario.id, d.evolucao]).sort()).toEqual([[dev, 100], [dev2, 0]].sort());
    const soP2 = await cronograma(sprint, `?idProjeto=${p2}`);
    expect(soP2.itens.map((i) => i.tarefa!.nome)).toEqual(['B']);
    expect(soP2.evolucao.sprint).toBe(80);
    expect(soP2.evolucao.porProjeto).toEqual([expect.objectContaining({ projeto: expect.objectContaining({ id: p2 }), evolucao: 0 })]);
    const soDev = await cronograma(sprint, `?idUsuario=${dev}`);
    expect(soDev.itens.map((i) => i.tarefa!.nome)).toEqual(['A']);
  });

  it('CA-20: o projetado tira o item a 100% e usa as horas restantes', async () => {
    const { sprint, itens } = await sprintAtiva([{ nome: 'A', horas: 8 }, { nome: 'B', horas: 16 }, { nome: 'C', horas: 8 }]);
    await acompanhar(itens[0], { evolucao: 100 });
    await acompanhar(itens[1], { evolucao: 50 });
    const c = await cronograma(sprint);
    const [a, b, cc] = c.itens;
    expect(a).toMatchObject({ inicioProjetado: null, entregaProjetada: null, restantes: 0 });
    expect(b).toMatchObject({ restantes: h(8), inicioProjetado: '2027-03-01', entregaProjetada: '2027-03-01' });
    expect(cc).toMatchObject({ inicioProjetado: '2027-03-02', entregaProjetada: '2027-03-02' });
  });

  it('CA-R1: o planejamento segue respondendo como antes', async () => {
    const { sprint } = await sprintAtiva([{ nome: 'A', horas: 8 }]);
    const r = await http().get(`/sprints/${sprint}/planejamento`);
    expect(r.status).toBe(200);
    expect(r.body.devs.find((d: { usuario: { id: number } }) => d.usuario.id === dev).itens).toHaveLength(1);
  });

  it('CA-R2: trocar para status não final não mexe no item', async () => {
    const { sprint, itens } = await sprintAtiva([{ nome: 'A', horas: 8 }]);
    const a = (await cronograma(sprint)).itens[0];
    await acompanhar(itens[0], { evolucao: 30 });
    const outro = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: false, id: { not: aberto } } })).id;
    await http().patch(`/tarefas/${a.tarefa!.id}`, { idStatus: outro });
    expect((await item(sprint, itens[0])).evolucao).toBe(30);
  });
});
