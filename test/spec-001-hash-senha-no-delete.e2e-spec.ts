/**
 * SPEC-001: DELETE /usuarios/:id não expõe mais o hash da senha.
 *
 * CA cobertos: CA-B1, CA-R1, CA-R3, CA-R4.
 * (CA-R2 é de tela: verificado por leitura de usuarios.tsx + build/lint do front.)
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
// SPEC-021 (RF-81): o usuário passou a ter isAdmin (desvio declarado)
const CAMPOS_SEM_SENHA = ['createdAt', 'email', 'id', 'isAdmin', 'nome', 'updatedAt'];

function criarBancoDescartavel(): string {
  const arquivo = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec001-')),
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

describe('SPEC-001: DELETE /usuarios/:id sem hash da senha', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let idAutenticado: number;
  let idDescartavel: number;

  beforeEach(async () => {
    const arquivo = criarBancoDescartavel();
    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: arquivo }),
    });

    const autenticado = await prisma.usuarios.create({
      data: { nome: 'Autenticado', email: 'auth@teste.com', senha: '$2b$10$hashqualquer', isAdmin: true }, // SPEC-021: admin (RF-82)
    });
    // Usuário sem tarefa nem comentário: apagável (não cai no 409 da SPEC-002).
    const descartavel = await prisma.usuarios.create({
      data: { nome: 'Smoke Test', email: 'smoke@teste.com', senha: '$2b$10$oKGwA8hash' },
    });
    idAutenticado = autenticado.id;
    idDescartavel = descartavel.id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    await app.init();

    token = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: autenticado.id, email: autenticado.email },
      { expiresIn: '1h' },
    );
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const autenticada = (metodo: 'get' | 'post' | 'patch' | 'delete', url: string) =>
    request(app.getHttpServer())[metodo](url).set('Authorization', `Bearer ${token}`);

  // ---------- CA-B ----------

  it('CA-B1: DELETE /usuarios/:id responde 200 com id, nome, email, createdAt e updatedAt, sem senha', async () => {
    const res = await autenticada('delete', `/usuarios/${idDescartavel}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('senha');
    expect(Object.keys(res.body).sort()).toEqual(CAMPOS_SEM_SENHA);
    expect(res.body).toMatchObject({ id: idDescartavel, nome: 'Smoke Test', email: 'smoke@teste.com' });
  });

  // ---------- CA-R ----------

  it('CA-R1: o usuário continua sendo efetivamente removido do banco', async () => {
    const res = await autenticada('delete', `/usuarios/${idDescartavel}`);
    expect(res.status).toBe(200);
    expect(await prisma.usuarios.findUnique({ where: { id: idDescartavel } })).toBeNull();
  });

  it('CA-R3: POST /usuarios continua sem devolver senha', async () => {
    const res = await request(app.getHttpServer())
      .post('/usuarios')
      .set('Authorization', `Bearer ${token}`) // SPEC-021: o cadastro exige admin (RF-82)
      .send({ nome: 'Novo', email: 'novo@teste.com', senha: '123456' });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('senha');
  });

  it('CA-R3: GET /usuarios continua sem devolver senha', async () => {
    const res = await autenticada('get', '/usuarios');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const u of res.body) expect(u).not.toHaveProperty('senha');
  });

  it('CA-R3: GET /usuarios/:id continua sem devolver senha', async () => {
    const res = await autenticada('get', `/usuarios/${idAutenticado}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('senha');
  });

  it('CA-R3: PATCH /usuarios/:id continua sem devolver senha (com e sem senha no corpo)', async () => {
    const semSenha = await autenticada('patch', `/usuarios/${idDescartavel}`).send({ nome: 'Renomeado' });
    expect(semSenha.status).toBe(200);
    expect(semSenha.body).not.toHaveProperty('senha');

    const comSenha = await autenticada('patch', `/usuarios/${idDescartavel}`).send({ senha: 'nova123' });
    expect(comSenha.status).toBe(200);
    expect(comSenha.body).not.toHaveProperty('senha');
  });

  it('CA-R4: apagar usuário inexistente continua respondendo 404', async () => {
    const res = await autenticada('delete', '/usuarios/9999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, message: 'Registro não encontrado' });
  });
});
