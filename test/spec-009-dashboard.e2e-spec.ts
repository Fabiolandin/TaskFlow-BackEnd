/**
 * SPEC-009: Dashboard (lado da API).
 *
 * CA cobertos: CA-01 a CA-08 (entrego) e CA-N1 (não-regrido).
 * CA-09 a CA-14, CA-N2 e CA-N4 são de tela: `docs/revisoes/evidencias/spec-009-verificar.mjs`.
 *
 * Sobe o AppModule real (guard JWT e ValidationPipe globais) com o AllExceptionsFilter
 * registrado como no main.ts, sobre um SQLite descartável criado das migrations.
 * O prisma/dev.db não é tocado.
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

function bancoDescartavel(): string {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec009-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

/** Dia de hoje pelo relógio do servidor, em horário local, AAAA-MM-DD. */
function hojeLocal(): string {
  const d = new Date();
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}
/** Dia (AAAA-MM-DD) deslocado `n` dias de hoje, em UTC puro, sem depender do fuso da máquina. */
function diaDeslocado(n: number): string {
  const [a, m, d] = hojeLocal().split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
const doDia = (dia: string) => new Date(`${dia}T00:00:00.000Z`);

describe('SPEC-009: Dashboard (API)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let jwt: JwtService;
  let ana: number; // criadora das tarefas
  let caio: number; // responsável das tarefas
  let pA: number;
  let pB: number;
  let pC: number; // sem tarefas
  const STATUS = { aFazer: 1, andamento: 2, revisao: 3, concluido: 4 };

  const token = () => jwt.sign({ sub: ana, email: 'ana@teste.com' }, { expiresIn: '1h' });
  const get = (url: string) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token()}`);
  const dashboard = () => get('/dashboard');
  const t = async (nome: string, idStatus: number, idProjeto: number, data_final?: Date | null) =>
    prisma.tarefas.create({
      data: {
        nome,
        idStatus,
        prioridade: 'Alta',
        idProjeto,
        idUsuarioCriador: ana,
        idUsuarioResponsavel: caio,
        data_final: data_final ?? null,
      },
    });
  const tarefas = async () => (await dashboard()).body.tarefas;

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: bancoDescartavel() }) });
    ana = (await prisma.usuarios.create({ data: { nome: 'Ana Secreta', email: 'ana@teste.com', senha: 'hash-secreto' } })).id;
    caio = (await prisma.usuarios.create({ data: { nome: 'Caio Oculto', email: 'caio@teste.com', senha: 'hash-secreto' } })).id;
    pA = (await prisma.projetos.create({ data: { nome: 'PA', idStatus: 1 } })).id;
    pB = (await prisma.projetos.create({ data: { nome: 'PB', idStatus: 1 } })).id;
    pC = (await prisma.projetos.create({ data: { nome: 'PC', idStatus: 1 } })).id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    jwt = new JwtService({ secret: process.env.JWT_SECRET });
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------- CA-08 ----------
  describe('CA-08: sem nenhuma tarefa', () => {
    it('200 com zeros e todas as listas completas', async () => {
      const res = await dashboard();
      expect(res.status).toBe(200);
      const d = res.body.tarefas;
      expect([d.total, d.abertas, d.concluidas, d.atrasadas]).toEqual([0, 0, 0, 0]);
      expect(d.porStatus.map((s: any) => s.id)).toEqual([1, 2, 3, 4]);
      expect(d.porStatus.every((s: any) => s.total === 0)).toBe(true);
      expect(d.porProjeto.map((p: any) => p.id).sort()).toEqual([pA, pB, pC].sort());
      expect(d.porProjeto.every((p: any) => p.total === 0)).toBe(true);
    });
  });

  // ---------- CA-01 ----------
  describe('CA-01: formato', () => {
    it('200 com { tarefas: {...} } exato, inteiros e listas', async () => {
      await t('x', STATUS.aFazer, pA);
      const res = await dashboard();
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['tarefas']);
      const d = res.body.tarefas;
      expect(Object.keys(d).sort()).toEqual(['abertas', 'atrasadas', 'concluidas', 'porProjeto', 'porStatus', 'total']);
      for (const k of ['total', 'abertas', 'concluidas', 'atrasadas']) expect(Number.isInteger(d[k])).toBe(true);
      expect(d.total).toBe(1);
      expect(Array.isArray(d.porStatus)).toBe(true);
      expect(Array.isArray(d.porProjeto)).toBe(true);
      expect(Object.keys(d.porStatus[0]).sort()).toEqual(['cor', 'id', 'isFinal', 'nome', 'total']);
      expect(Object.keys(d.porProjeto[0]).sort()).toEqual(['id', 'nome', 'total']);
    });
  });

  // ---------- CA-02 ----------
  describe('CA-02: concluídas por isFinal, abertas é o resto', () => {
    it('conta por isFinal', async () => {
      await t('a', STATUS.aFazer, pA);
      await t('b', STATUS.andamento, pA);
      await t('c', STATUS.concluido, pA);
      await t('d', STATUS.concluido, pB);
      await t('e', STATUS.revisao, pB);
      const d = await tarefas();
      expect(d).toMatchObject({ total: 5, abertas: 3, concluidas: 2 });
      expect(d.total).toBe(d.abertas + d.concluidas);
      expect(d.total).toBe(await prisma.tarefas.count());
    });
    it('status de nome diferente de "Concluído" mas com isFinal conta como concluída', async () => {
      const cancel = await prisma.statusTarefa.create({ data: { nome: 'Cancelada', ordem: 9, isFinal: true } });
      await t('a', cancel.id, pA);
      await t('b', STATUS.aFazer, pA);
      expect(await tarefas()).toMatchObject({ total: 2, abertas: 1, concluidas: 1 });
    });
  });

  // ---------- CA-03 ----------
  describe('CA-03: porStatus', () => {
    it('todos os status, com zeros, ordem asc e desempate por id, com cor e isFinal', async () => {
      await prisma.statusTarefa.update({ where: { id: STATUS.revisao }, data: { cor: '#3B82F6' } });
      // x tem a mesma ordem que o 'Concluído' (4), com id maior: o desempate é o id
      const x = await prisma.statusTarefa.create({ data: { nome: 'X', ordem: 4 } });
      const y = await prisma.statusTarefa.create({ data: { nome: 'Y', ordem: 0 } });
      await t('a', STATUS.aFazer, pA);
      await t('b', STATUS.aFazer, pA);
      await t('c', STATUS.concluido, pB);
      const d = await tarefas();
      expect(d.porStatus.map((s: any) => s.id)).toEqual([y.id, 1, 2, 3, 4, x.id]);
      expect(d.porStatus.map((s: any) => s.total)).toEqual([0, 2, 0, 0, 1, 0]);
      expect(d.porStatus.find((s: any) => s.id === STATUS.revisao)).toEqual({
        id: 3,
        nome: 'Em Revisão',
        cor: '#3B82F6',
        isFinal: false,
        total: 0,
      });
      expect(d.porStatus.find((s: any) => s.id === STATUS.concluido)).toEqual({
        id: 4,
        nome: 'Concluído',
        cor: null,
        isFinal: true,
        total: 1,
      });
      expect(d.porStatus.reduce((s: number, e: any) => s + e.total, 0)).toBe(d.total);
    });
  });

  // ---------- CA-04 ----------
  describe('CA-04: porProjeto', () => {
    it('todos os projetos, total desc, desempate por id, soma = total', async () => {
      const pD = (await prisma.projetos.create({ data: { nome: 'PD', idStatus: 1 } })).id;
      await t('1', STATUS.aFazer, pB);
      await t('2', STATUS.aFazer, pB);
      await t('3', STATUS.concluido, pB);
      await t('4', STATUS.aFazer, pD);
      await t('5', STATUS.aFazer, pA);
      const d = await tarefas();
      expect(d.porProjeto).toEqual([
        { id: pB, nome: 'PB', total: 3 },
        { id: pA, nome: 'PA', total: 1 },
        { id: pD, nome: 'PD', total: 1 },
        { id: pC, nome: 'PC', total: 0 },
      ]);
      expect(d.porProjeto.reduce((s: number, p: any) => s + p.total, 0)).toBe(d.total);
    });
  });

  // ---------- CA-05 ----------
  describe('CA-05: atrasadas', () => {
    it('só aberta com prazo anterior a hoje; hoje, futuro, sem prazo e concluída não contam', async () => {
      await t('passado aberta', STATUS.aFazer, pA, doDia('2000-01-01'));
      await t('ontem aberta', STATUS.andamento, pA, doDia(diaDeslocado(-1)));
      await t('hoje aberta', STATUS.aFazer, pA, doDia(hojeLocal()));
      await t('amanha aberta', STATUS.aFazer, pA, doDia(diaDeslocado(1)));
      await t('futuro aberta', STATUS.aFazer, pA, doDia('2999-12-31'));
      await t('sem prazo aberta', STATUS.aFazer, pA, null);
      await t('passado concluida', STATUS.concluido, pA, doDia('2000-01-01'));
      const d = await tarefas();
      expect(d).toMatchObject({ total: 7, abertas: 6, concluidas: 1, atrasadas: 2 });
    });
    it('prazo de hoje com horário no fim do dia UTC não é atrasada; o de ontem é', async () => {
      await t('hoje fim do dia', STATUS.aFazer, pA, new Date(`${hojeLocal()}T23:59:59.000Z`));
      await t('ontem fim do dia', STATUS.aFazer, pA, new Date(`${diaDeslocado(-1)}T23:59:59.000Z`));
      expect((await tarefas()).atrasadas).toBe(1);
    });
  });

  // ---------- CA-06 ----------
  describe('CA-06: isFinal muda os números; renomear não', () => {
    it('marcar e desmarcar isFinal move abertas, concluídas e atrasadas', async () => {
      await t('a', STATUS.andamento, pA, doDia('2000-01-01'));
      await t('b', STATUS.andamento, pA, null);
      await t('c', STATUS.aFazer, pB, doDia('2000-01-01'));
      expect(await tarefas()).toMatchObject({ abertas: 3, concluidas: 0, atrasadas: 2 });

      await prisma.statusTarefa.update({ where: { id: STATUS.andamento }, data: { isFinal: true } });
      const depois = await tarefas();
      expect(depois).toMatchObject({ abertas: 1, concluidas: 2, atrasadas: 1 });
      expect(depois.porStatus.find((s: any) => s.id === STATUS.andamento).isFinal).toBe(true);

      await prisma.statusTarefa.update({ where: { id: STATUS.andamento }, data: { isFinal: false } });
      expect(await tarefas()).toMatchObject({ abertas: 3, concluidas: 0, atrasadas: 2 });
    });
    it('renomear um status não muda nenhum número', async () => {
      await t('a', STATUS.andamento, pA, doDia('2000-01-01'));
      await t('b', STATUS.concluido, pA);
      const antes = await tarefas();
      await prisma.statusTarefa.update({ where: { id: STATUS.andamento }, data: { nome: 'Concluído de verdade' } });
      await prisma.statusTarefa.update({ where: { id: STATUS.concluido }, data: { nome: 'Em andamento' } });
      const depois = await tarefas();
      for (const k of ['total', 'abertas', 'concluidas', 'atrasadas']) expect(depois[k]).toBe(antes[k]);
      expect(depois.porStatus.map((s: any) => s.total)).toEqual(antes.porStatus.map((s: any) => s.total));
    });
  });

  // ---------- CA-07 ----------
  describe('CA-07: acesso', () => {
    it('sem token: 401', async () => {
      const res = await request(app.getHttpServer()).get('/dashboard');
      expect(res.status).toBe(401);
    });
    it('token inválido: 401', async () => {
      const res = await request(app.getHttpServer()).get('/dashboard').set('Authorization', 'Bearer lixo');
      expect(res.status).toBe(401);
    });
    it('com tarefas que têm criador e responsável, nenhum nível traz senha, nome ou email de usuário', async () => {
      await t('a', STATUS.aFazer, pA, doDia('2000-01-01'));
      await t('b', STATUS.concluido, pB);
      const res = await dashboard();
      expect(res.status).toBe(200);
      expect(res.body.tarefas.total).toBe(2); // não passa no vazio
      const json = JSON.stringify(res.body);
      expect(json).not.toMatch(/senha/i);
      expect(json).not.toMatch(/hash-secreto/);
      expect(json).not.toMatch(/Ana Secreta|Caio Oculto|ana@teste|caio@teste/);
      expect(json).not.toMatch(/email|usuario|responsavel|criador/i);
    });
  });

  // ---------- CA-N1 ----------
  describe('CA-N1: rotas existentes respondem como antes', () => {
    it('GET /tarefas, /projetos, /statustarefa e /statusprojeto', async () => {
      await t('a', STATUS.aFazer, pA);
      await t('b', STATUS.concluido, pB);
      await dashboard();

      const tar = await get('/tarefas');
      expect(tar.status).toBe(200);
      expect(tar.body.total).toBe(2);

      const proj = await get('/projetos');
      expect(proj.status).toBe(200);
      expect(proj.body.total).toBe(3);

      const st = await get('/statustarefa');
      expect(st.status).toBe(200);
      expect(st.body.map((s: any) => s.id)).toEqual([1, 2, 3, 4]);
      expect(Object.keys(st.body[0]).sort()).toEqual(['cor', 'createdAt', 'id', 'isFinal', 'nome', 'ordem', 'updatedAt']);

      const sp = await get('/statusprojeto');
      expect(sp.status).toBe(200);
      expect(sp.body).toHaveLength(5);
    });
  });
});
