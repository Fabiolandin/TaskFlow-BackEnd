/**
 * SPEC-005: a tela de Projetos passa a usar a API. Nenhuma alteração de backend.
 *
 * CA cobertos: CA-09 (não-regrido) e o lado servidor do contrato que a tela consome em
 * CA-02, CA-05, CA-07, CA-12 e CA-13. A tela em si é verificada por
 * `docs/revisoes/evidencias/spec-005-verificar.mjs` (helpers reais + Chrome headless).
 * Por não haver mudança de backend, este arquivo passa antes e depois: é guarda de contrato,
 * não teste de entrego.
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
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec005-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

describe('SPEC-005: contrato de /projetos que a tela consome', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let usuarios: number[];

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: bancoDescartavel() }) });
    usuarios = [];
    for (const nome of ['Ana', 'Bia', 'Caio']) {
      const u = await prisma.usuarios.create({
        data: { nome, email: `${nome.toLowerCase()}@teste.com`, senha: 'hash-secreto' },
      });
      usuarios.push(u.id);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    await app.init();

    token = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: usuarios[0], email: 'ana@teste.com' },
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
    };
  };

  it('CA-09: GET /projetos responde { data, total, page, totalPages } com limit padrão 9', async () => {
    for (let i = 1; i <= 10; i++) await prisma.projetos.create({ data: { nome: `P${i}`, idStatus: 1 } });

    const res = await http().get('/projetos').expect(200);

    expect(Object.keys(res.body).sort()).toEqual(['data', 'page', 'total', 'totalPages']);
    expect(res.body).toMatchObject({ total: 10, page: 1, totalPages: 2 });
    expect(res.body.data).toHaveLength(9);
  });

  it('CA-07 (servidor): page=2&limit=9 devolve o que sobrou, em ordem de id', async () => {
    for (let i = 1; i <= 10; i++) await prisma.projetos.create({ data: { nome: `P${i}`, idStatus: 1 } });

    const res = await http().get('/projetos?page=2&limit=9').expect(200);

    expect(res.body.page).toBe(2);
    expect(res.body.data.map((p: { nome: string }) => p.nome)).toEqual(['P10']);
  });

  it('CA-05/CA-12/CA-13/CA-02 (servidor): o payload do formulário grava, e os membros voltam no GET', async () => {
    // exatamente o que montarDadosProjeto produz com todos os campos preenchidos
    const criado = await http()
      .post('/projetos', { nome: 'Novo', descricao: 'Desc', idStatus: 2, data_inicio: '2026-11-06' })
      .expect(201);
    expect(criado.body.data_inicio).toBe('2026-11-06T00:00:00.000Z'); // meia-noite UTC: a tela formata em UTC
    expect(criado.body.membros).toBeUndefined(); // o POST não traz membros: a tela recarrega a lista

    for (const idUsuario of [usuarios[1], usuarios[2]]) {
      await http().post(`/projetos/${criado.body.id}/membros`, { idUsuario }).expect(201);
    }

    const lista = await http().get('/projetos').expect(200);
    const projeto = lista.body.data.find((p: { id: number }) => p.id === criado.body.id);
    expect(projeto.status).toMatchObject({ id: 2, nome: 'Em andamento' });
    expect(projeto.membros).toEqual([
      { id: usuarios[1], nome: 'Bia', email: 'bia@teste.com' },
      { id: usuarios[2], nome: 'Caio', email: 'caio@teste.com' },
    ]);
  });

  it('CA-05 (servidor): o mínimo do formulário (nome + status) basta', async () => {
    const res = await http().post('/projetos', { nome: 'Só nome', idStatus: 1 }).expect(201);
    expect(res.body).toMatchObject({ nome: 'Só nome', descricao: null, data_inicio: null });
  });
});
