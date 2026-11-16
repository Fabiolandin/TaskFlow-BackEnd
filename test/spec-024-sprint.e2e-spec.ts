/**
 * SPEC-024: sprint, fila e planejamento.
 *
 * CA cobertos: CA-01..CA-21, CA-28..CA-38 (entrego) e CA-R1, CA-R3 (não-regrido).
 * CA-22..CA-27, CA-46 são da função pura: src/sprints/fila.logica.spec.ts.
 * CA-39..CA-45 são da tela: docs/revisoes/evidencias/spec-024-verificar.mjs.
 *
 * Banco SQLite descartável, criado a cada teste a partir das migrations. O prisma/dev.db não é tocado.
 * Os devs de teste trabalham 8h TODOS os dias (inclusive fim de semana), para as contas ficarem diretas.
 * As sprints ficam em 2027 (depois de hoje), salvo no teste que precisa de "hoje" dentro da sprint.
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
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec024-')), 'test.db');
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
const somarDias = (data: string, n: number) => new Date(Date.parse(`${data}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

type Item = {
  id: number; ordem: number; tipo: 'tarefa' | 'avulso'; planejadas: number; semEstimativa: boolean; naoPrevista: boolean;
  inicioPrevisto: string | null; entregaPrevista: string | null; inicioProjetado: string | null; entregaProjetada: string | null;
  transborda: { minutos: number; sprint: { id: number | null; nome: string } } | null; idItemOrigem: number | null;
  tarefa: { id: number; nome: string } | null; avulso: { nome: string; recorrente: boolean } | null;
};
type Dev = { usuario: { id: number; nome: string }; capacidade: number; planejadas: number; ocupacao: number | null; semCapacidade: boolean; itens: Item[] };

describe('SPEC-024: sprint, fila e planejamento', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokenAdmin: string;
  let tokenComum: string;
  let tokenDev: string;
  let admin: number;
  let comum: number;
  let dev: number;
  let dev2: number;
  let p1: number;
  let aberto: number;
  let final: number;

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }) });
    const cria = (nome: string, isAdmin = false) => prisma.usuarios.create({ data: { nome, email: `${nome.toLowerCase()}@teste.com`, senha: 'x', isAdmin } });
    const [uAdmin, uComum, uDev, uDev2] = [await cria('Admin', true), await cria('Comum'), await cria('Dev'), await cria('Dev2')];
    [admin, comum, dev, dev2] = [uAdmin.id, uComum.id, uDev.id, uDev2.id];
    for (const u of [dev, dev2]) await prisma.jornadas.create({ data: { idUsuario: u, vigencia: new Date('2020-01-01T00:00:00Z'), ...TODO_DIA } });
    const sp = await prisma.statusProjeto.findFirstOrThrow();
    p1 = (await prisma.projetos.create({ data: { nome: 'P1', idStatus: sp.id } })).id;
    await prisma.usuariosProjetos.createMany({ data: [{ idUsuario: comum, idProjeto: p1 }, { idUsuario: dev, idProjeto: p1 }] });
    aberto = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: false } })).id;
    final = (await prisma.statusTarefa.findFirstOrThrow({ where: { isFinal: true } })).id;

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
      put: (url: string, body: object) => auth(request(server).put(url)).send(body),
      del: (url: string) => auth(request(server).delete(url)),
    };
  };

  const tarefa = async (nome: string, extra: object = {}) =>
    (await http().post('/tarefas', { nome, idStatus: aberto, prioridade: 'Média', idProjeto: p1, ...extra })).body as { id: number };
  const estimada = (nome: string, horas: number) => tarefa(nome, { minutosEstimados: h(horas) });
  const sprint = async (nome: string, dataInicio: string, dataFim: string) =>
    (await http().post('/sprints', { nome, dataInicio, dataFim })).body as { id: number; status: string };
  const alocar = (idSprint: number, idTarefa: number, idUsuario = dev, extra: object = {}) =>
    http().post(`/sprints/${idSprint}/itens`, { idTarefa, idUsuario, ...extra });
  const planejamento = async (idSprint: number) => (await http().get(`/sprints/${idSprint}/planejamento`)).body as { devs: Dev[] };
  const filaDe = async (idSprint: number, usuario = dev) => (await planejamento(idSprint)).devs.find((d) => d.usuario.id === usuario)!;

  // ---------- RF-108: campos de refinamento ----------

  describe('refinamento da tarefa (RF-108)', () => {
    it('CA-01/CA-02: o responsável e o admin estimam', async () => {
      const t = await tarefa('T', { idUsuarioResponsavel: comum });
      const r = await http(tokenComum).patch(`/tarefas/${t.id}`, { minutosEstimados: 360, minutosBuffer: 60 });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ minutosEstimados: 360, minutosBuffer: 60 });
      expect((await http().patch(`/tarefas/${t.id}`, { minutosEstimados: 480 })).status).toBe(200);
    });

    it('CA-03: quem não é admin nem responsável não estima, mas edita issue', async () => {
      const t = await tarefa('T', { idUsuarioResponsavel: comum });
      const r = await http(tokenDev).patch(`/tarefas/${t.id}`, { minutosEstimados: 60 });
      expect(r.status).toBe(403);
      expect(r.body.message).toBe('Só o administrador ou o responsável podem estimar a tarefa');
      expect((await http(tokenDev).patch(`/tarefas/${t.id}`, { minutosBuffer: 60 })).status).toBe(403);
      const issue = await http(tokenDev).patch(`/tarefas/${t.id}`, { issueExterna: 'PEL-139', solicitante: 'Cliente X' });
      expect(issue.status).toBe(200);
      expect(issue.body).toMatchObject({ issueExterna: 'PEL-139', solicitante: 'Cliente X', minutosEstimados: null });
    });

    it('CA-04: valores fora do limite → 400', async () => {
      const t = await tarefa('T');
      for (const ruim of [{ minutosEstimados: -1 }, { minutosEstimados: 100001 }, { minutosBuffer: 1.5 }, { issueExterna: 'x'.repeat(51) }, { solicitante: 'x'.repeat(101) }]) {
        expect((await http().patch(`/tarefas/${t.id}`, ruim)).status).toBe(400);
      }
    });

    it('CA-05: mudar a estimativa grava a atividade', async () => {
      const t = await tarefa('T');
      await http().patch(`/tarefas/${t.id}`, { minutosEstimados: 360 });
      await http().patch(`/tarefas/${t.id}`, { minutosEstimados: 480, issueExterna: 'ALL-635' });
      const atividades = (await http().get(`/tarefas/${t.id}/atividades`)).body as { campo: string; valorAnterior: string | null; valorNovo: string | null }[];
      expect(atividades.filter((a) => a.campo === 'estimativa').map((a) => [a.valorAnterior, a.valorNovo])).toEqual([[null, '360'], ['360', '480']]);
      expect(atividades.find((a) => a.campo === 'issue')).toMatchObject({ valorAnterior: null, valorNovo: 'ALL-635' });
    });

    it('CA-06: toda tarefa traz as 4 chaves novas, nulas por padrão', async () => {
      const t = await tarefa('T');
      const r = await http().get(`/tarefas/${t.id}`);
      expect(r.body).toMatchObject({ minutosEstimados: null, minutosBuffer: null, issueExterna: null, solicitante: null });
      const lista = await http().get(`/tarefas?idProjeto=${p1}`);
      expect(Object.keys(lista.body.data[0])).toEqual(expect.arrayContaining(['minutosEstimados', 'minutosBuffer', 'issueExterna', 'solicitante']));
    });
  });

  // ---------- RF-109: sprint ----------

  describe('sprint (RF-109)', () => {
    it('CA-07: admin cria sprint em Planejamento; fim antes do início → 400', async () => {
      const r = await http().post('/sprints', { nome: 'Sprint 1', dataInicio: '2027-03-01', dataFim: '2027-03-05' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ nome: 'Sprint 1', status: 'Planejamento' });
      expect((await http().post('/sprints', { nome: 'X', dataInicio: '2027-04-10', dataFim: '2027-04-09' })).status).toBe(400);
      expect((await http().post('/sprints', { nome: '', dataInicio: '2027-04-10', dataFim: '2027-04-11' })).status).toBe(400);
    });

    it('CA-08: um dia em comum com outra sprint → 409 com o nome dela', async () => {
      await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const r = await http().post('/sprints', { nome: 'Sprint 2', dataInicio: '2027-03-05', dataFim: '2027-03-09' });
      expect(r.status).toBe(409);
      expect(r.body.message).toBe('O período se sobrepõe à sprint Sprint 1');
      expect((await http().post('/sprints', { nome: 'Sprint 2', dataInicio: '2027-03-06', dataFim: '2027-03-09' })).status).toBe(201);
    });

    it('CA-09: não admin não escreve em sprint nem em item', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const t = await estimada('T', 4);
      const c = http(tokenComum);
      const nova = await c.post('/sprints', { nome: 'X', dataInicio: '2027-05-01', dataFim: '2027-05-02' });
      expect(nova.status).toBe(403);
      expect(nova.body.message).toBe('Apenas administradores podem planejar sprints');
      expect((await c.patch(`/sprints/${s.id}`, { nome: 'Y' })).status).toBe(403);
      expect((await c.post(`/sprints/${s.id}/itens`, { idTarefa: t.id, idUsuario: dev })).status).toBe(403);
      expect((await c.post(`/sprints/${s.id}/ativar`)).status).toBe(403);
      const item = (await alocar(s.id, t.id)).body;
      expect((await c.patch(`/itens/${item.id}`, { posicao: 1 })).status).toBe(403);
      expect((await c.put(`/sprints/${s.id}/fila/${dev}`, { ids: [item.id] })).status).toBe(403);
      expect((await c.del(`/itens/${item.id}`)).status).toBe(403);
      expect((await c.del(`/sprints/${s.id}`)).status).toBe(403);
      expect((await c.get(`/sprints/${s.id}/planejamento`)).status).toBe(200);
      expect((await c.get('/sprints')).status).toBe(200);
    });

    it('CA-10: sprint ativa aceita mudar datas sem mexer na linha de base; fechada não muda', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const t = await estimada('T', 16);
      await alocar(s.id, t.id);
      await http().post(`/sprints/${s.id}/ativar`);
      const antes = (await filaDe(s.id)).itens[0];
      const r = await http().patch(`/sprints/${s.id}`, { dataInicio: '2027-03-02', dataFim: '2027-03-08' });
      expect(r.status).toBe(200);
      const depois = await filaDe(s.id);
      expect(depois.capacidade).toBe(h(56));
      expect(depois.itens[0].inicioProjetado).toBe('2027-03-02');
      expect(depois.itens[0].inicioPrevisto).toBe(antes.inicioPrevisto);
      expect(depois.itens[0].entregaPrevista).toBe(antes.entregaPrevista);
      await prisma.sprints.update({ where: { id: s.id }, data: { status: 'Fechada' } });
      const fechada = await http().patch(`/sprints/${s.id}`, { nome: 'Outro' });
      expect(fechada.status).toBe(409);
      expect(fechada.body.message).toBe('Sprint fechada');
    });

    it('CA-11: excluir sprint em Planejamento apaga os itens; ativa → 409', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      await alocar(s.id, (await estimada('T', 4)).id);
      expect((await http().del(`/sprints/${s.id}`)).status).toBe(200);
      expect(await prisma.itensSprint.count()).toBe(0);
      const s2 = await sprint('Sprint 2', '2027-04-01', '2027-04-05');
      await http().post(`/sprints/${s2.id}/ativar`);
      expect((await http().del(`/sprints/${s2.id}`)).status).toBe(409);
    });
  });

  // ---------- RF-110, RF-111: itens ----------

  describe('itens (RF-110, RF-111)', () => {
    it('CA-12: a mesma tarefa duas vezes na mesma sprint → 409', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const t = await estimada('T', 4);
      expect((await alocar(s.id, t.id)).status).toBe(201);
      expect((await alocar(s.id, t.id, dev2)).status).toBe(409);
    });

    it('CA-13: alocar para usuário sem jornada → 400 com o nome dele', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const r = await alocar(s.id, (await estimada('T', 4)).id, comum);
      expect(r.status).toBe(400);
      expect(r.body.message).toBe('Comum não tem jornada cadastrada');
    });

    it('CA-14: sem posição vai para o fim; com posição 1, para o começo', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const a = (await alocar(s.id, (await estimada('A', 1)).id)).body;
      const b = (await alocar(s.id, (await estimada('B', 1)).id)).body;
      const c = (await alocar(s.id, (await estimada('C', 1)).id, dev, { posicao: 1 })).body;
      expect((await filaDe(s.id)).itens.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
    });

    it('CA-15: reordenar exige exatamente os itens do dev', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const a = (await alocar(s.id, (await estimada('A', 1)).id)).body;
      const b = (await alocar(s.id, (await estimada('B', 1)).id)).body;
      const outro = (await alocar(s.id, (await estimada('X', 1)).id, dev2)).body;
      expect((await http().put(`/sprints/${s.id}/fila/${dev}`, { ids: [a.id] })).status).toBe(400);
      expect((await http().put(`/sprints/${s.id}/fila/${dev}`, { ids: [a.id, b.id, outro.id] })).status).toBe(400);
      expect((await http().put(`/sprints/${s.id}/fila/${dev}`, { ids: [b.id, a.id] })).status).toBe(200);
      expect((await filaDe(s.id)).itens.map((i) => i.id)).toEqual([b.id, a.id]);
    });

    it('CA-16: item avulso entra na fila e não vira tarefa; nome vazio → 400', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const tarefasAntes = await prisma.tarefas.count();
      const r = await http().post(`/sprints/${s.id}/itens`, { nome: 'Reuniões', minutosAvulsos: 240, recorrente: true, idUsuario: dev });
      expect(r.status).toBe(201);
      expect(await prisma.tarefas.count()).toBe(tarefasAntes);
      const item = (await filaDe(s.id)).itens[0];
      expect(item).toMatchObject({ tipo: 'avulso', planejadas: 240, tarefa: null, avulso: { nome: 'Reuniões', recorrente: true } });
      expect((await http().post(`/sprints/${s.id}/itens`, { nome: '', minutosAvulsos: 60, idUsuario: dev })).status).toBe(400);
      expect((await http().patch(`/itens/${r.body.id}`, { minutosAvulsos: 120 })).status).toBe(200);
      expect((await filaDe(s.id)).itens[0].planejadas).toBe(120);
    });

    it('CA-17: remover item de sprint ativa → 204; de fechada → 409', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const a = (await alocar(s.id, (await estimada('A', 1)).id)).body;
      const b = (await alocar(s.id, (await estimada('B', 1)).id)).body;
      await http().post(`/sprints/${s.id}/ativar`);
      expect((await http().del(`/itens/${a.id}`)).status).toBe(204);
      await prisma.sprints.update({ where: { id: s.id }, data: { status: 'Fechada' } });
      expect((await http().del(`/itens/${b.id}`)).status).toBe(409);
    });

    it('CA-18: alocar define o responsável e grava a atividade; trocar o dev troca o responsável', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const t = await estimada('T', 4);
      const item = (await alocar(s.id, t.id)).body;
      expect((await http().get(`/tarefas/${t.id}`)).body.responsavel.id).toBe(dev);
      const atividades = (await http().get(`/tarefas/${t.id}/atividades`)).body as { campo: string; idNovo: number; autor: { id: number } }[];
      expect(atividades.find((a) => a.campo === 'responsavel')).toMatchObject({ idNovo: dev, autor: { id: admin } });
      const troca = await http().patch(`/itens/${item.id}`, { idUsuario: dev2 });
      expect(troca.status).toBe(200);
      // dev2 não era membro: a troca também avisa (achado da verificação de tela)
      expect(troca.body.membroAdicionado).toEqual({ idProjeto: p1, nomeProjeto: 'P1' });
      expect((await http().get(`/tarefas/${t.id}`)).body.responsavel.id).toBe(dev2);
    });

    it('CA-19: dev de fora do projeto vira membro', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const r = await alocar(s.id, (await estimada('T', 4)).id, dev2);
      expect(r.status).toBe(201);
      expect(r.body.membroAdicionado).toEqual({ idProjeto: p1, nomeProjeto: 'P1' });
      const membros = (await http().get(`/projetos/${p1}`)).body.membros as { id: number }[];
      expect(membros.map((m) => m.id)).toContain(dev2);
      const r2 = await alocar(s.id, (await estimada('T2', 4)).id, dev);
      expect(r2.body.membroAdicionado).toBeNull();
    });

    it('CA-20: remover o item não desfaz responsável nem membresia; mudar o responsável por fora não muda o dev', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const t = await estimada('T', 4);
      const item = (await alocar(s.id, t.id, dev2)).body;
      await http().patch(`/tarefas/${t.id}`, { idUsuarioResponsavel: comum });
      expect((await filaDe(s.id, dev2)).itens.map((i) => i.id)).toEqual([item.id]);
      await http().del(`/itens/${item.id}`);
      expect((await http().get(`/tarefas/${t.id}`)).body.responsavel.id).toBe(comum);
      expect(await prisma.usuariosProjetos.count({ where: { idUsuario: dev2, idProjeto: p1 } })).toBe(1);
    });

    it('CA-21: sem estimativa ocupa 0h; estimar muda o item na hora', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const t = await tarefa('Sem horas');
      await alocar(s.id, t.id);
      expect((await filaDe(s.id)).itens[0]).toMatchObject({ planejadas: 0, semEstimativa: true });
      await http().patch(`/tarefas/${t.id}`, { minutosEstimados: h(6), minutosBuffer: h(1) });
      expect((await filaDe(s.id)).itens[0]).toMatchObject({ planejadas: h(7), semEstimativa: false });
    });
  });

  // ---------- RF-113..RF-119: fila, ativação, transbordo, ocupação ----------

  describe('fila, ativação e transbordo (RF-113..RF-119)', () => {
    it('CA-28: em Planejamento, o transbordo é só cálculo e refaz ao reordenar', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const a = (await alocar(s.id, (await estimada('A', 36)).id)).body;
      const b = (await alocar(s.id, (await estimada('B', 10)).id)).body;
      const fila = await filaDe(s.id);
      expect(fila.itens[1].transborda).toEqual({ minutos: h(6), sprint: { id: null, nome: 'Sprint 2' } });
      expect(await prisma.sprints.count()).toBe(1);
      await http().put(`/sprints/${s.id}/fila/${dev}`, { ids: [b.id, a.id] });
      const nova = await filaDe(s.id);
      expect(nova.itens[0].transborda).toBeNull();
      expect(nova.itens[1].transborda).toEqual({ minutos: h(6), sprint: { id: null, nome: 'Sprint 2' } });
    });

    it('CA-29/CA-30/CA-31: ativar divide, move e cria a próxima sprint', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const a = (await alocar(s.id, (await estimada('A', 36)).id)).body;
      const b = (await alocar(s.id, (await estimada('B', 10)).id)).body;
      const tc = await estimada('C', 8);
      const c = (await alocar(s.id, tc.id)).body;
      const r = await http().post(`/sprints/${s.id}/ativar`);
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('Ativa');

      const proxima = await prisma.sprints.findFirstOrThrow({ where: { nome: 'Sprint 2' } });
      expect(proxima.dataInicio.toISOString().slice(0, 10)).toBe('2027-03-06');
      expect(proxima.dataFim.toISOString().slice(0, 10)).toBe('2027-03-10');
      expect(proxima.status).toBe('Planejamento');

      const atual = await filaDe(s.id);
      expect(atual.itens.map((i) => i.id)).toEqual([a.id, b.id]);
      expect(atual.itens[1]).toMatchObject({ planejadas: h(4), entregaPrevista: '2027-03-05' });

      const seguinte = await filaDe(proxima.id);
      expect(seguinte.itens.map((i) => [i.tarefa?.nome, i.planejadas, i.idItemOrigem])).toEqual([
        ['B', h(6), b.id],
        ['C', h(8), null],
      ]);
      expect(c.id).not.toBe(seguinte.itens[1].id);
      // o que transborda inteiro volta a acompanhar a tarefa
      await http().patch(`/tarefas/${tc.id}`, { minutosEstimados: h(9) });
      expect((await filaDe(proxima.id)).itens[1].planejadas).toBe(h(9));
    });

    it('CA-29: os transbordos entram no topo da fila da próxima sprint que já existe', async () => {
      const s = await sprint('Sprint 7', '2027-03-01', '2027-03-05');
      const s2 = await sprint('Sprint 8', '2027-03-08', '2027-03-12');
      const ja = (await alocar(s2.id, (await estimada('Já estava', 2)).id)).body;
      await alocar(s.id, (await estimada('A', 38)).id);
      await alocar(s.id, (await estimada('B', 4)).id);
      await http().post(`/sprints/${s.id}/ativar`);
      expect(await prisma.sprints.count()).toBe(2);
      const fila = await filaDe(s2.id);
      expect(fila.itens.map((i) => i.tarefa?.nome)).toEqual(['B', 'Já estava']);
      expect(fila.itens[0].planejadas).toBe(h(2));
      expect(fila.itens[1].id).toBe(ja.id);
    });

    it('CA-32: com a sprint ativa, só marca o transbordo', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      await alocar(s.id, (await estimada('A', 36)).id);
      await http().post(`/sprints/${s.id}/ativar`);
      const sprintsAntes = await prisma.sprints.count();
      await alocar(s.id, (await estimada('B', 10)).id);
      const fila = await filaDe(s.id);
      expect(fila.itens[1].transborda?.minutos).toBe(h(6));
      expect(await prisma.sprints.count()).toBe(sprintsAntes);
      expect(fila.itens).toHaveLength(2);
    });

    it('CA-33: criar sprint copia os avulsos recorrentes da anterior, depois dos transbordos', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      await http().post(`/sprints/${s.id}/itens`, { nome: 'Reuniões', minutosAvulsos: 240, recorrente: true, idUsuario: dev });
      await http().post(`/sprints/${s.id}/itens`, { nome: 'Pontual', minutosAvulsos: 60, recorrente: false, idUsuario: dev2 });
      await alocar(s.id, (await estimada('Grande', 40)).id);
      await http().post(`/sprints/${s.id}/ativar`);
      const s2 = await prisma.sprints.findFirstOrThrow({ where: { nome: 'Sprint 2' } });
      const fila = await filaDe(s2.id);
      expect(fila.itens.map((i) => i.tarefa?.nome ?? i.avulso?.nome)).toEqual(['Grande', 'Reuniões']);
      expect(fila.itens[1].avulso).toEqual({ nome: 'Reuniões', recorrente: true });
      expect((await filaDe(s2.id, dev2)).itens).toHaveLength(0);
      // criar por POST também copia, da sprint imediatamente anterior
      const s3 = await sprint('Sprint 3', '2027-03-11', '2027-03-15');
      expect((await filaDe(s3.id)).itens.map((i) => i.avulso?.nome)).toEqual(['Reuniões']);
    });

    it('CA-34: ativar grava o previsto; reordenar muda o projetado, não o previsto; segunda ativa → 409', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const a = (await alocar(s.id, (await estimada('A', 8)).id)).body;
      const b = (await alocar(s.id, (await estimada('B', 8)).id)).body;
      await http().post(`/sprints/${s.id}/ativar`);
      const itens = await prisma.itensSprint.findMany({ orderBy: { ordem: 'asc' } });
      expect(itens.map((i) => [i.inicioPrevisto?.toISOString().slice(0, 10), i.entregaPrevista?.toISOString().slice(0, 10)])).toEqual([
        ['2027-03-01', '2027-03-01'],
        ['2027-03-02', '2027-03-02'],
      ]);
      await http().put(`/sprints/${s.id}/fila/${dev}`, { ids: [b.id, a.id] });
      const fila = await filaDe(s.id);
      const doB = fila.itens.find((i) => i.id === b.id)!;
      expect(doB).toMatchObject({ inicioPrevisto: '2027-03-02', inicioProjetado: '2027-03-01' });
      expect((await http().post(`/sprints/${s.id}/ativar`)).status).toBe(409);
      const outra = await sprint('Sprint 9', '2027-06-01', '2027-06-05');
      const r = await http().post(`/sprints/${outra.id}/ativar`);
      expect(r.status).toBe(409);
    });

    it('CA-35: item criado com a sprint ativa é não previsto, com a linha de base do momento', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      await alocar(s.id, (await estimada('A', 8)).id);
      await http().post(`/sprints/${s.id}/ativar`);
      const novo = (await alocar(s.id, (await estimada('Urgente', 4)).id)).body;
      const item = (await filaDe(s.id)).itens.find((i) => i.id === novo.id)!;
      expect(item).toMatchObject({ naoPrevista: true, inicioPrevisto: '2027-03-02', entregaPrevista: '2027-03-02', inicioProjetado: '2027-03-02' });
    });

    it('CA-35: projetado parte de hoje quando a sprint já começou', async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const s = await sprint('Sprint Hoje', somarDias(hoje, -2), somarDias(hoje, 5));
      await alocar(s.id, (await estimada('A', 8)).id);
      await http().post(`/sprints/${s.id}/ativar`);
      const item = (await filaDe(s.id)).itens[0];
      expect(item).toMatchObject({ inicioPrevisto: somarDias(hoje, -2), inicioProjetado: hoje });
    });

    it('CA-36: ocupação acima de 100% alerta sem bloquear; avulsos contam; sem capacidade', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      expect((await alocar(s.id, (await estimada('A', 46)).id)).status).toBe(201);
      await http().post(`/sprints/${s.id}/itens`, { nome: 'Reuniões', minutosAvulsos: h(4), idUsuario: dev });
      const fila = await filaDe(s.id);
      expect(fila).toMatchObject({ capacidade: h(40), planejadas: h(50), ocupacao: 125, semCapacidade: false });
      await prisma.ausencias.create({ data: { idUsuario: dev2, tipo: 'Ferias', dataInicio: new Date('2027-03-01T00:00:00Z'), dataFim: new Date('2027-03-05T00:00:00Z') } });
      await alocar(s.id, (await estimada('B', 2)).id, dev2);
      expect(await filaDe(s.id, dev2)).toMatchObject({ capacidade: 0, ocupacao: null, semCapacidade: true });
      // quem não tem jornada não aparece como dev
      expect((await planejamento(s.id)).devs.map((d) => d.usuario.id).sort()).toEqual([dev, dev2].sort());
    });

    it('CA-37: excluir tarefa que está numa sprint pede confirmação e apaga o item', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      await alocar(s.id, (await estimada('A', 36)).id);
      const t = await estimada('B', 10);
      await alocar(s.id, t.id);
      await http().post(`/sprints/${s.id}/ativar`);
      const r = await http().del(`/tarefas/${t.id}`);
      expect(r.status).toBe(409);
      // a parte transbordada pôs a tarefa também na Sprint 2: as duas são nomeadas
      expect(r.body.message).toBe('Tarefa está nas sprints Sprint 1, Sprint 2');
      expect(r.body.emSprint).toEqual([
        expect.objectContaining({ nome: 'Sprint 1', status: 'Ativa' }),
        expect.objectContaining({ nome: 'Sprint 2', status: 'Planejamento' }),
      ]);
      // a parte transbordada (Sprint 2) aponta para o item de origem; a exclusão desliga a ligação
      const ok = await http().del(`/tarefas/${t.id}?removerDaSprint=true`);
      expect(ok.status).toBe(200);
      expect(await prisma.tarefas.count({ where: { id: t.id } })).toBe(0);
      expect(await prisma.itensSprint.count({ where: { idTarefa: t.id } })).toBe(0);

      const t2 = await estimada('C', 2);
      const s9 = await sprint('Sprint 9', '2027-06-01', '2027-06-05');
      await alocar(s9.id, t2.id);
      await prisma.sprints.update({ where: { id: s9.id }, data: { status: 'Fechada' } });
      expect((await http().del(`/tarefas/${t2.id}`)).status).toBe(409);
      expect((await http().del(`/tarefas/${t2.id}?removerDaSprint=true`)).status).toBe(200);
    });

    it('CA-38: backlog = não concluídas fora de sprint aberta', async () => {
      const s = await sprint('Sprint 1', '2027-03-01', '2027-03-05');
      const solta = await estimada('Solta', 1);
      const naSprint = await estimada('Na sprint', 1);
      await tarefa('Concluída', { idStatus: final });
      const soNaFechada = await estimada('Só na fechada', 1);
      await alocar(s.id, naSprint.id);
      const s9 = await sprint('Sprint 9', '2027-06-01', '2027-06-05');
      await alocar(s9.id, soNaFechada.id);
      await prisma.sprints.update({ where: { id: s9.id }, data: { status: 'Fechada' } });
      const r = await http().get('/tarefas?foraDeSprint=true&limit=100');
      expect(r.status).toBe(200);
      expect(r.body.data.map((t: { id: number }) => t.id).sort()).toEqual([solta.id, soNaFechada.id].sort());
    });
  });

  describe('não-regrido', () => {
    it('CA-R1: tarefa fora de sprint é excluída como antes', async () => {
      const t = await tarefa('T');
      expect((await http().del(`/tarefas/${t.id}`)).status).toBe(200);
    });
  });
});
