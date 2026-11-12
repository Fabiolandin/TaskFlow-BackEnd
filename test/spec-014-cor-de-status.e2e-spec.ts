/**
 * SPEC-014: cor de status só aceita hex #RRGGBB.
 *
 * CA cobertos: CA-B1, CA-B2, CA-B3 (bug) e CA-R1, CA-R2, CA-R3, CA-R5 (API) (não-regrido).
 * CA-B4, CA-B5 e CA-R4 são da tela: docs/revisoes/evidencias/spec-014-verificar.mjs.
 *
 * Cada caso roda nas duas rotas (/statusprojeto e /statustarefa), que têm DTOs gêmeos.
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
    fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec014-')),
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

const ROTAS = ['/statusprojeto', '/statustarefa'];
const INVALIDAS = ['vermelho', 'E5484D', '#E5484', '#E5484DFF'];

describe('SPEC-014: cor de status em hex', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;

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
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    await app.init();

    token = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: usuario.id, email: usuario.email },
      { expiresIn: '1h' },
    );
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
    };
  };

  // status de partida com cor gravada, criado pela própria API
  const criarComCor = async (rota: string, cor: string | null = '#112233') => {
    const res = await http().post(rota, { nome: 'Base', ordem: 50, cor });
    expect(res.status).toBe(201);
    return res.body as { id: number; nome: string; cor: string | null };
  };
  const ler = async (rota: string, id: number) => (await http().get(`${rota}/${id}`)).body;
  const contar = async (rota: string) => ((await http().get(rota)).body as unknown[]).length;

  describe.each(ROTAS)('%s', (rota) => {
    it.each(INVALIDAS)('CA-B1: POST com cor "%s" responde 400 e não grava', async (cor) => {
      const antes = await contar(rota);
      const res = await http().post(rota, { nome: 'Inválido', ordem: 9, cor });
      expect(res.status).toBe(400);
      expect(await contar(rota)).toBe(antes);
    });

    it('CA-B2: PATCH com cor "vermelho" responde 400 e a cor gravada não muda', async () => {
      const base = await criarComCor(rota);
      const res = await http().patch(`${rota}/${base.id}`, { cor: 'vermelho' });
      expect(res.status).toBe(400);
      expect((await ler(rota, base.id)).cor).toBe('#112233');
    });

    it('CA-B3: cor "" no POST e no PATCH é gravada como null', async () => {
      const criado = await http().post(rota, { nome: 'Vazio', ordem: 9, cor: '' });
      expect(criado.status).toBe(201);
      expect(criado.body.cor).toBeNull();
      expect((await ler(rota, criado.body.id)).cor).toBeNull();

      const base = await criarComCor(rota);
      const editado = await http().patch(`${rota}/${base.id}`, { cor: '' });
      expect(editado.status).toBe(200);
      expect(editado.body.cor).toBeNull();
      expect((await ler(rota, base.id)).cor).toBeNull();
    });

    it.each(['#E5484D', '#e5484d'])('CA-R1: cor "%s" grava no POST e no PATCH', async (cor) => {
      const criado = await http().post(rota, { nome: 'Hex', ordem: 9, cor });
      expect(criado.status).toBe(201);
      expect(criado.body.cor).toBe(cor);

      const base = await criarComCor(rota);
      const editado = await http().patch(`${rota}/${base.id}`, { cor });
      expect(editado.status).toBe(200);
      expect((await ler(rota, base.id)).cor).toBe(cor);
    });

    it('CA-R2: cor ausente ou null grava sem cor; PATCH {cor: null} limpa', async () => {
      const ausente = await http().post(rota, { nome: 'Sem cor', ordem: 9 });
      expect(ausente.status).toBe(201);
      expect(ausente.body.cor).toBeNull();

      const nula = await http().post(rota, { nome: 'Cor nula', ordem: 9, cor: null });
      expect(nula.status).toBe(201);
      expect(nula.body.cor).toBeNull();

      const base = await criarComCor(rota);
      const limpo = await http().patch(`${rota}/${base.id}`, { cor: null });
      expect(limpo.status).toBe(200);
      expect((await ler(rota, base.id)).cor).toBeNull();
    });

    it('CA-R3: PATCH sem cor não mexe na cor', async () => {
      const base = await criarComCor(rota);
      const res = await http().patch(`${rota}/${base.id}`, { nome: 'Renomeado' });
      expect(res.status).toBe(200);
      const depois = await ler(rota, base.id);
      expect(depois.nome).toBe('Renomeado');
      expect(depois.cor).toBe('#112233');
    });

    it('CA-R5: nome obrigatório e ordem inteira continuam exigidos', async () => {
      expect((await http().post(rota, { ordem: 9 })).status).toBe(400);
      expect((await http().post(rota, { nome: '', ordem: 9 })).status).toBe(400);
      // SPEC-018 alterou o RF-21: ordem ausente é aceita (vai para o fim); continua valendo a ordem não inteira
      expect((await http().post(rota, { nome: 'X' })).status).toBe(201);
      expect((await http().post(rota, { nome: 'X', ordem: 1.5 })).status).toBe(400);

      const base = await criarComCor(rota);
      expect((await http().patch(`${rota}/${base.id}`, { nome: '' })).status).toBe(400);
      expect((await http().patch(`${rota}/${base.id}`, { ordem: 'abc' })).status).toBe(400);
      expect(await ler(rota, base.id)).toMatchObject({ nome: 'Base', ordem: 50 });
    });
  });
});
