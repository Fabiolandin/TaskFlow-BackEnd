/**
 * SPEC-023: calendário (jornadas, feriados, ausências) e capacidade.
 *
 * CA cobertos: CA-01..CA-14, CA-23 (entrego) e CA-R2 (não-regrido).
 * CA-15..CA-22, CA-24 são da função pura: src/calendario/capacidade.logica.spec.ts.
 * CA-25..CA-27 são da tela: docs/revisoes/evidencias/spec-023-verificar.mjs.
 *
 * Banco SQLite descartável, criado a cada teste a partir das migrations. O prisma/dev.db não é tocado.
 * A BrasilAPI é simulada pelo provider CLIENTE_FERIADOS: nenhum teste vai à rede.
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
import { CLIENTE_FERIADOS, type ClienteFeriados } from '../src/calendario/cliente-feriados';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

function criarBancoDescartavel(): string {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec023-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

const SEMANA = { seg: 480, ter: 480, qua: 480, qui: 480, sex: 480, sab: 0, dom: 0 };

//o que a BrasilAPI responde em cada teste; uma função que lança simula erro/timeout
let respostaApi: () => Promise<unknown>;
const clienteFalso: ClienteFeriados = { buscar: () => respostaApi() };

describe('SPEC-023: calendário e capacidade', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokenAdmin: string;
  let tokenComum: string;
  let dev: number;
  let comum: number;

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }) });
    const admin = await prisma.usuarios.create({ data: { nome: 'Admin', email: 'admin@teste.com', senha: 'x', isAdmin: true } });
    const usuarioComum = await prisma.usuarios.create({ data: { nome: 'Comum', email: 'comum@teste.com', senha: 'x' } });
    dev = (await prisma.usuarios.create({ data: { nome: 'Dev', email: 'dev@teste.com', senha: 'x' } })).id;
    comum = usuarioComum.id;
    respostaApi = async () => [];
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(CLIENTE_FERIADOS).useValue(clienteFalso)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    tokenAdmin = jwt.sign({ sub: admin.id, email: admin.email }, { expiresIn: '1h' });
    tokenComum = jwt.sign({ sub: usuarioComum.id, email: usuarioComum.email }, { expiresIn: '1h' });
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
      post: (url: string, body: object) => auth(request(server).post(url)).send(body),
      patch: (url: string, body: object) => auth(request(server).patch(url)).send(body),
      del: (url: string) => auth(request(server).delete(url)),
    };
  };
  const PROIBIDO = 'Apenas administradores podem alterar o calendário';

  describe('jornadas (RF-101)', () => {
    it('CA-01: admin cria jornada e o GET devolve', async () => {
      const r = await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-01-01', ...SEMANA });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ idUsuario: dev, seg: 480, sab: 0 });
      expect(r.body.vigencia.slice(0, 10)).toBe('2026-01-01');
      const lista = await http(tokenComum).get(`/jornadas?idUsuario=${dev}`);
      expect(lista.status).toBe(200);
      expect(lista.body).toHaveLength(1);
      expect(lista.body[0].id).toBe(r.body.id);
    });

    it('CA-02: mesma vigência repetida → 409; outra vigência → 201', async () => {
      expect((await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-01-01', ...SEMANA })).status).toBe(201);
      expect((await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-01-01', ...SEMANA })).status).toBe(409);
      expect((await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-07-01', ...SEMANA, seg: 360 })).status).toBe(201);
      expect(await prisma.jornadas.count()).toBe(2);
    });

    it('CA-03: minutos fora de 0..1440 ou não inteiros → 400, nada gravado', async () => {
      for (const ruim of [{ seg: -1 }, { seg: 1441 }, { seg: 30.5 }, { seg: '480' }]) {
        const r = await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-01-01', ...SEMANA, ...ruim });
        expect(r.status).toBe(400);
      }
      expect((await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-13-01', ...SEMANA })).status).toBe(400);
      const semDia = { ...SEMANA } as Partial<typeof SEMANA>;
      delete semDia.dom;
      expect((await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-01-01', ...semDia })).status).toBe(400);
      expect(await prisma.jornadas.count()).toBe(0);
    });

    it('CA-04: não admin não escreve (403); lê (200)', async () => {
      const criada = await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-01-01', ...SEMANA });
      const c = http(tokenComum);
      const novo = await c.post('/jornadas', { idUsuario: dev, vigencia: '2026-02-01', ...SEMANA });
      expect(novo.status).toBe(403);
      expect(novo.body.message).toBe(PROIBIDO);
      expect((await c.patch(`/jornadas/${criada.body.id}`, { seg: 100 })).status).toBe(403);
      expect((await c.del(`/jornadas/${criada.body.id}`)).status).toBe(403);
      expect((await c.get('/jornadas')).status).toBe(200);
      expect((await prisma.jornadas.findUniqueOrThrow({ where: { id: criada.body.id } })).seg).toBe(480);
    });

    it('admin edita e exclui jornada', async () => {
      const criada = await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-01-01', ...SEMANA });
      const editada = await http().patch(`/jornadas/${criada.body.id}`, { seg: 240 });
      expect(editada.status).toBe(200);
      expect(editada.body.seg).toBe(240);
      expect((await http().del(`/jornadas/${criada.body.id}`)).status).toBe(200);
      expect(await prisma.jornadas.count()).toBe(0);
    });
  });

  describe('feriados (RF-102, RF-103)', () => {
    it('CA-05: data repetida → 409; minutosDescontados 0 ou 1441 → 400', async () => {
      expect((await http().post('/feriados', { data: '2026-04-21', nome: 'Tiradentes' })).status).toBe(201);
      expect((await http().post('/feriados', { data: '2026-04-21', nome: 'De novo' })).status).toBe(409);
      expect((await http().post('/feriados', { data: '2026-05-01', nome: 'X', minutosDescontados: 0 })).status).toBe(400);
      expect((await http().post('/feriados', { data: '2026-05-01', nome: 'X', minutosDescontados: 1441 })).status).toBe(400);
      expect((await http().post('/feriados', { data: '2026-05-01', nome: '' })).status).toBe(400);
      expect(await prisma.feriados.count()).toBe(1);
    });

    it('CA-06: GET ?ano= devolve só o ano, ordenado por data', async () => {
      await http().post('/feriados', { data: '2026-12-25', nome: 'Natal' });
      await http().post('/feriados', { data: '2027-01-01', nome: 'Ano novo' });
      await http().post('/feriados', { data: '2026-04-21', nome: 'Tiradentes', minutosDescontados: 240 });
      const r = await http(tokenComum).get('/feriados?ano=2026');
      expect(r.status).toBe(200);
      expect(r.body.map((f: { nome: string }) => f.nome)).toEqual(['Tiradentes', 'Natal']);
      expect(r.body[0].minutosDescontados).toBe(240);
      expect(r.body[1].minutosDescontados).toBeNull();
    });

    it('CA-07: importar cria só as datas novas e não mexe na que já existe', async () => {
      await http().post('/feriados', { data: '2026-02-17', nome: 'Carnaval (meio)', minutosDescontados: 240 });
      respostaApi = async () => [
        { date: '2026-01-01', name: 'Confraternização mundial', type: 'national' },
        { date: '2026-02-17', name: 'Carnaval', type: 'national' },
        { date: '2026-04-21', name: 'Tiradentes', type: 'national' },
      ];
      const r = await http().post('/feriados/importar', { ano: 2026 });
      expect(r.status).toBe(201);
      expect(r.body).toEqual({ criados: 2, ignorados: 1 });
      const carnaval = await prisma.feriados.findFirstOrThrow({ where: { data: new Date('2026-02-17T00:00:00.000Z') } });
      expect(carnaval.nome).toBe('Carnaval (meio)');
      expect(carnaval.minutosDescontados).toBe(240);
      const tiradentes = await prisma.feriados.findFirstOrThrow({ where: { data: new Date('2026-04-21T00:00:00.000Z') } });
      expect(tiradentes.minutosDescontados).toBeNull();
    });

    it('CA-08: BrasilAPI com erro, timeout ou formato inesperado → 502 e nada gravado', async () => {
      const casos: (() => Promise<unknown>)[] = [
        async () => { throw new Error('HTTP 500'); },
        async () => { throw new Error('timeout'); },
        async () => ({ erro: 'formato inesperado' }),
        async () => [{ date: '2026-01-01' }],
        async () => [{ date: 'ontem', name: 'X' }],
      ];
      for (const caso of casos) {
        respostaApi = caso;
        const r = await http().post('/feriados/importar', { ano: 2026 });
        expect(r.status).toBe(502);
        expect(r.body.message).toBe('Não foi possível importar os feriados de 2026');
      }
      expect(await prisma.feriados.count()).toBe(0);
    });

    it('CA-08: ano fora de 2000..2100 → 400', async () => {
      expect((await http().post('/feriados/importar', { ano: 1999 })).status).toBe(400);
      expect((await http().post('/feriados/importar', { ano: 'abc' })).status).toBe(400);
    });

    it('CA-09: não admin não importa nem escreve feriado', async () => {
      respostaApi = async () => [{ date: '2026-01-01', name: 'Ano novo', type: 'national' }];
      const c = http(tokenComum);
      const imp = await c.post('/feriados/importar', { ano: 2026 });
      expect(imp.status).toBe(403);
      expect(imp.body.message).toBe(PROIBIDO);
      expect((await c.post('/feriados', { data: '2026-04-21', nome: 'T' })).status).toBe(403);
      expect(await prisma.feriados.count()).toBe(0);
    });
  });

  describe('ausências (RF-104)', () => {
    it('CA-10: fim antes do início → 400 (no POST e no PATCH)', async () => {
      expect((await http().post('/ausencias', { idUsuario: dev, tipo: 'Folga', dataInicio: '2026-03-10', dataFim: '2026-03-09' })).status).toBe(400);
      const ok = await http().post('/ausencias', { idUsuario: dev, tipo: 'Folga', dataInicio: '2026-03-10', dataFim: '2026-03-10' });
      expect(ok.status).toBe(201);
      expect((await http().patch(`/ausencias/${ok.body.id}`, { dataFim: '2026-03-01' })).status).toBe(400);
      expect(await prisma.ausencias.count()).toBe(1);
    });

    it('CA-11: GET por período devolve as que tocam o período', async () => {
      await http().post('/ausencias', { idUsuario: dev, tipo: 'Ferias', dataInicio: '2026-03-01', dataFim: '2026-03-12' });
      await http().post('/ausencias', { idUsuario: dev, tipo: 'Folga', dataInicio: '2026-03-21', dataFim: '2026-03-25' });
      await http().post('/ausencias', { idUsuario: comum, tipo: 'Folga', dataInicio: '2026-03-15', dataFim: '2026-03-15' });
      const r = await http(tokenComum).get(`/ausencias?idUsuario=${dev}&inicio=2026-03-10&fim=2026-03-20`);
      expect(r.status).toBe(200);
      expect(r.body).toHaveLength(1);
      expect(r.body[0].tipo).toBe('Ferias');
      expect((await http().get('/ausencias?inicio=2026-03-10&fim=2026-03-20')).body).toHaveLength(2);
    });

    it('CA-12: tipo fora da lista → 400; minutosPorDia fora de 1..1440 → 400', async () => {
      expect((await http().post('/ausencias', { idUsuario: dev, tipo: 'Viagem', dataInicio: '2026-03-10', dataFim: '2026-03-10' })).status).toBe(400);
      expect((await http().post('/ausencias', { idUsuario: dev, tipo: 'Outro', dataInicio: '2026-03-10', dataFim: '2026-03-10', minutosPorDia: 0 })).status).toBe(400);
      expect(await prisma.ausencias.count()).toBe(0);
    });

    it('CA-13: não admin não escreve ausência', async () => {
      const r = await http(tokenComum).post('/ausencias', { idUsuario: dev, tipo: 'Folga', dataInicio: '2026-03-10', dataFim: '2026-03-10' });
      expect(r.status).toBe(403);
      expect(r.body.message).toBe(PROIBIDO);
      expect(await prisma.ausencias.count()).toBe(0);
    });
  });

  describe('exclusão de usuário (RF-16)', () => {
    it('CA-14: usuário com jornada ou ausência não é excluído (409)', async () => {
      await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-01-01', ...SEMANA });
      const r = await http().del(`/usuarios/${dev}`);
      expect(r.status).toBe(409);
      expect(r.body.message).toBe('Usuário em uso: tem jornada ou ausência cadastrada');
      await http().post('/ausencias', { idUsuario: comum, tipo: 'Folga', dataInicio: '2026-03-10', dataFim: '2026-03-10' });
      expect((await http().del(`/usuarios/${comum}`)).status).toBe(409);
      expect(await prisma.usuarios.count()).toBe(3);
    });

    it('CA-R2: usuário sem calendário segue a regra de hoje', async () => {
      expect((await http().del(`/usuarios/${dev}`)).status).toBe(200);
    });
  });

  describe('capacidade (RF-106)', () => {
    it('CA-23: 2 semanas com 14 dias, motivo certo e total', async () => {
      await http().post('/jornadas', { idUsuario: dev, vigencia: '2026-01-01', ...SEMANA });
      await http().post('/feriados', { data: '2026-03-04', nome: 'Feriado X' });
      await http().post('/ausencias', { idUsuario: dev, tipo: 'Atestado', dataInicio: '2026-03-10', dataFim: '2026-03-10', minutosPorDia: 120 });
      const r = await http(tokenComum).get(`/capacidade?idUsuario=${dev}&inicio=2026-03-02&fim=2026-03-15`);
      expect(r.status).toBe(200);
      expect(r.body.dias).toHaveLength(14);
      expect(r.body.dias[0]).toEqual({ data: '2026-03-02', jornada: 480, desconto: 0, motivo: null, capacidade: 480, util: true });
      expect(r.body.dias[2]).toMatchObject({ data: '2026-03-04', capacidade: 0, motivo: 'feriado: Feriado X', util: false });
      expect(r.body.dias[8]).toMatchObject({ data: '2026-03-10', desconto: 120, capacidade: 360, motivo: 'ausencia: Atestado' });
      // 10 dias úteis × 480, menos o feriado (480) e o atestado (120)
      expect(r.body.total).toBe(10 * 480 - 480 - 120);
    });

    it('CA-23: período de 367 dias, fim antes do início ou data inválida → 400', async () => {
      expect((await http().get(`/capacidade?idUsuario=${dev}&inicio=2026-01-01&fim=2027-01-02`)).status).toBe(400);
      expect((await http().get(`/capacidade?idUsuario=${dev}&inicio=2026-01-01&fim=2027-01-01`)).status).toBe(200);
      expect((await http().get(`/capacidade?idUsuario=${dev}&inicio=2026-03-10&fim=2026-03-01`)).status).toBe(400);
      expect((await http().get(`/capacidade?idUsuario=${dev}&inicio=2026-02-30&fim=2026-03-01`)).status).toBe(400);
      expect((await http().get(`/capacidade?inicio=2026-03-01&fim=2026-03-02`)).status).toBe(400);
    });
  });
});
