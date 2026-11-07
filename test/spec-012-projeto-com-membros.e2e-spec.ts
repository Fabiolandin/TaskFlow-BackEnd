/**
 * SPEC-012: criar projeto com membros é uma gravação só — ou grava tudo, ou nada.
 *
 * CA cobertos: CA-01 a CA-06 (entrego) e CA-10 a CA-13 (não-regrido).
 * CA-07 a CA-09 e CA-14 são de tela: `docs/revisoes/evidencias/spec-012-verificar.mjs`.
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

function bancoDescartavel(): string {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec012-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

describe('SPEC-012: projeto e membros numa gravação só', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let ana: number;
  let bia: number;
  let caio: number;

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: bancoDescartavel() }) });
    const criar = (nome: string) =>
      prisma.usuarios.create({
        data: { nome, email: `${nome.toLowerCase()}@teste.com`, senha: 'hash-secreto' },
      });
    ana = (await criar('Ana')).id;
    bia = (await criar('Bia')).id;
    caio = (await criar('Caio')).id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    await app.init();

    token = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: ana, email: 'ana@teste.com' },
      { expiresIn: '1h' },
    );
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => {
    const s = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(s.get(url)),
      post: (url: string, body: object) => auth(s.post(url).send(body)),
      patch: (url: string, body: object) => auth(s.patch(url).send(body)),
      delete: (url: string) => auth(s.delete(url)),
    };
  };

  const contagens = async () => ({
    projetos: await prisma.projetos.count(),
    vinculos: await prisma.usuariosProjetos.count(),
  });

  const idsDe = (membros: { id: number }[]) => membros.map((m) => m.id).sort((a, b) => a - b);

  function esperaErro(res: request.Response, status: number) {
    expect(res.status).toBe(status);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'statusCode']);
    expect(typeof res.body.message).toBe('string');
  }

  // ---------- Entrego ----------

  it('CA-01: POST /projetos com membros existentes → 201, e GET /projetos/:id traz os membros', async () => {
    const res = await http().post('/projetos', { nome: 'Com membros', idStatus: 1, membros: [ana, bia] });
    expect(res.status).toBe(201);

    const lido = await http().get(`/projetos/${res.body.id}`).expect(200);
    expect(idsDe(lido.body.membros)).toEqual([ana, bia].sort((a, b) => a - b));
  });

  it('CA-02: membro inexistente → 400 citando o id; nada gravado', async () => {
    const antes = await contagens();
    const res = await http().post('/projetos', { nome: 'X', idStatus: 1, membros: [ana, 9999, 8888] });
    esperaErro(res, 400);
    expect(res.body.message).toContain('9999');
    expect(res.body.message).toContain('8888');
    expect(await contagens()).toEqual(antes);
  });

  it('CA-02 (D-3): usuário que some entre a checagem e o create → 400 do P2003; rollback, nada gravado', async () => {
    // simula a corrida: a pré-checagem "vê" o usuário 9999, mas ele não existe no create
    const delegado = prisma.usuarios;
    const original = delegado.findMany.bind(delegado);
    (delegado as unknown as { findMany: unknown }).findMany = async () => [{ id: ana }, { id: 9999 }];
    try {
      const antes = await contagens();
      const res = await http().post('/projetos', { nome: 'Corrida', idStatus: 1, membros: [ana, 9999] });
      esperaErro(res, 400);
      expect(res.body.message).toMatch(/Referência inexistente/);
      expect(await contagens()).toEqual(antes);
    } finally {
      (delegado as unknown as { findMany: unknown }).findMany = original;
    }
  });

  it('CA-03: membro repetido → 400; nada gravado', async () => {
    const antes = await contagens();
    const res = await http().post('/projetos', { nome: 'X', idStatus: 1, membros: [ana, ana] });
    esperaErro(res, 400);
    expect(await contagens()).toEqual(antes);
  });

  it.each([['"2"', '2'], ['[1.5]', [1.5]], ['["2"]', ['2']], ['{}', {}]])(
    'CA-04: membros = %s (não é lista de inteiros) → 400; nada gravado',
    async (_rotulo, membros) => {
      const antes = await contagens();
      const res = await http().post('/projetos', { nome: 'X', idStatus: 1, membros });
      esperaErro(res, 400);
      expect(await contagens()).toEqual(antes);
    },
  );

  it('CA-05: a resposta do POST traz status (objeto) e membros [{ id, nome, email }], sem senha', async () => {
    const res = await http().post('/projetos', { nome: 'Formato', idStatus: 1, membros: [bia] });
    expect(res.status).toBe(201);
    expect(res.body.status).toEqual(expect.objectContaining({ id: 1, nome: expect.any(String) }));
    expect(res.body.membros).toEqual([{ id: bia, nome: 'Bia', email: 'bia@teste.com' }]);
    expect(res.body).not.toHaveProperty('usuariosProjetos');
    expect(JSON.stringify(res.body)).not.toMatch(/senha|hash-secreto/);

    // mesmo formato de GET /projetos/:id
    const lido = await http().get(`/projetos/${res.body.id}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(Object.keys(lido.body).sort());
  });

  it('CA-06: idStatus inexistente com membros válidos → 400; nada gravado', async () => {
    const antes = await contagens();
    const res = await http().post('/projetos', { nome: 'X', idStatus: 9999, membros: [ana, bia] });
    esperaErro(res, 400);
    expect(await contagens()).toEqual(antes);
  });

  // ---------- Não-regrido ----------

  it.each([['ausente', undefined], ['[]', []]])(
    'CA-10: POST /projetos com membros %s → 201, sem vínculos',
    async (_rotulo, membros) => {
      const corpo = membros === undefined ? { nome: 'Sem', idStatus: 1 } : { nome: 'Sem', idStatus: 1, membros };
      const res = await http().post('/projetos', corpo);
      expect(res.status).toBe(201);
      expect(await prisma.usuariosProjetos.count({ where: { idProjeto: res.body.id } })).toBe(0);
    },
  );

  it('CA-11: PATCH /projetos/:id com membros no corpo não altera os membros e não responde 500', async () => {
    const p = await prisma.projetos.create({ data: { nome: 'P', idStatus: 1 } });
    await prisma.usuariosProjetos.create({ data: { idUsuario: ana, idProjeto: p.id } });

    const res = await http().patch(`/projetos/${p.id}`, { nome: 'P2', membros: [caio] });
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);

    const lido = await http().get(`/projetos/${p.id}`).expect(200);
    expect(lido.body.nome).toBe('P2');
    expect(idsDe(lido.body.membros)).toEqual([ana]);
  });

  it('CA-12: rotas /projetos/:id/membros mantêm contrato (repetido 409, responsável 409)', async () => {
    const p = await prisma.projetos.create({ data: { nome: 'P', idStatus: 1 } });

    const add = await http().post(`/projetos/${p.id}/membros`, { idUsuario: bia });
    expect(add.status).toBe(201);
    expect(add.body).toEqual({ id: bia, nome: 'Bia', email: 'bia@teste.com' });

    esperaErro(await http().post(`/projetos/${p.id}/membros`, { idUsuario: bia }), 409);

    const lista = await http().get(`/projetos/${p.id}/membros`).expect(200);
    expect(lista.body).toEqual([{ id: bia, nome: 'Bia', email: 'bia@teste.com' }]);

    await prisma.tarefas.create({
      data: {
        nome: 'T',
        idStatus: 1,
        prioridade: 'Alta',
        idUsuarioCriador: ana,
        idUsuarioResponsavel: bia,
        idProjeto: p.id,
      },
    });
    esperaErro(await http().delete(`/projetos/${p.id}/membros/${bia}`), 409);

    await http().post(`/projetos/${p.id}/membros`, { idUsuario: caio }).expect(201);
    const removido = await http().delete(`/projetos/${p.id}/membros/${caio}`);
    expect(removido.status).toBe(200);
    expect(removido.body).toEqual({ id: caio, nome: 'Caio', email: 'caio@teste.com' });
  });

  it('CA-13: GET /projetos continua paginado em { data, total, page, totalPages }', async () => {
    for (let i = 1; i <= 10; i++) await prisma.projetos.create({ data: { nome: `P${i}`, idStatus: 1 } });
    const res = await http().get('/projetos?page=2&limit=9').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'page', 'total', 'totalPages']);
    expect(res.body).toEqual(expect.objectContaining({ total: 10, page: 2, totalPages: 2 }));
    expect(res.body.data).toHaveLength(1);
  });
});
