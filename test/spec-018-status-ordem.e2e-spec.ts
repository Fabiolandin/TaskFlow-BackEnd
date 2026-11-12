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
    fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec018-')),
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


/**
 * SPEC-018: status reordenados por arrastar (rota de ordem) e ordem opcional no POST.
 *
 * CA cobertos: CA-01, CA-02, CA-03, CA-04 (entrego) e CA-R1, CA-R2, CA-R3 (não-regrido).
 * CA-05..CA-10 são da tela: docs/revisoes/evidencias/spec-018-verificar.mjs.
 */
const ROTAS = ['/statusprojeto', '/statustarefa'];

describe('SPEC-018: ordem dos status', () => {
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
    app.useGlobalFilters(new AllExceptionsFilter());
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
      put: (url: string, body: object) => auth(request(server).put(url)).send(body),
    };
  };

  type S = { id: number; nome: string; ordem: number };
  const listar = async (rota: string) => (await http().get(rota)).body as S[];
  const ordens = async (rota: string) => (await listar(rota)).map((s) => [s.id, s.ordem]);

  describe.each(ROTAS)('%s', (rota) => {
    it('CA-01/CA-02: PUT /ordem com todos os ids grava ordem = posição e devolve a lista ordenada', async () => {
      const ids = (await listar(rota)).map((s) => s.id);
      expect(ids.length).toBeGreaterThan(1);
      const nova = [...ids].reverse();
      const res = await http().put(`${rota}/ordem`, { ids: nova });
      expect(res.status).toBe(200);
      expect((res.body as S[]).map((s) => s.id)).toEqual(nova);
      expect((res.body as S[]).map((s) => s.ordem)).toEqual(nova.map((_, i) => i + 1));
      expect((await listar(rota)).map((s) => s.id)).toEqual(nova); // CA-R3
    });

    it('CA-03: lista incompleta, repetida, com id estranho, não inteira ou ausente responde 400 e nada muda', async () => {
      const ids = (await listar(rota)).map((s) => s.id);
      const antes = await ordens(rota);
      const invalidos: object[] = [
        { ids: ids.slice(1) },
        { ids: [...ids, ids[0]] },
        { ids: [...ids, 9999] },
        { ids: [...ids.slice(1), 'a'] },
        { ids: 'x' },
        {},
      ];
      for (const corpo of invalidos) {
        const res = await http().put(`${rota}/ordem`, corpo);
        expect(res.status).toBe(400);
        expect(typeof res.body.message).toBe('string');
      }
      expect(await ordens(rota)).toEqual(antes);
    });

    it('CA-04: POST sem ordem vai para o fim (maior + 1)', async () => {
      const maior = Math.max(...(await listar(rota)).map((s) => s.ordem));
      const res = await http().post(rota, { nome: 'Sem ordem' });
      expect(res.status).toBe(201);
      expect(res.body.ordem).toBe(maior + 1);
      expect((await listar(rota)).at(-1)?.id).toBe(res.body.id);
    });

    it('CA-04: no cadastro vazio, POST sem ordem grava 1', async () => {
      if (rota === '/statustarefa') await prisma.statusTarefa.deleteMany();
      else await prisma.statusProjeto.deleteMany();
      const res = await http().post(rota, { nome: 'Primeiro' });
      expect(res.status).toBe(201);
      expect(res.body.ordem).toBe(1);
      expect((await http().put(`${rota}/ordem`, { ids: [res.body.id] })).status).toBe(200);
    });

    it('CA-R1: POST e PATCH com ordem informada gravam o valor', async () => {
      const criado = await http().post(rota, { nome: 'Com ordem', ordem: 42 });
      expect(criado.status).toBe(201);
      expect(criado.body.ordem).toBe(42);
      const editado = await http().patch(`${rota}/${criado.body.id}`, { ordem: 7 });
      expect(editado.status).toBe(200);
      expect(editado.body.ordem).toBe(7);
    });

    it('CA-R2: cor inválida segue 400 no POST sem ordem', async () => {
      const res = await http().post(rota, { nome: 'Cor ruim', cor: 'vermelho' });
      expect(res.status).toBe(400);
    });
  });
});
