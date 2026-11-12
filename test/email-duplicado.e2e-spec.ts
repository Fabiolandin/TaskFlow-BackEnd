/**
 * Bug: cadastrar ou editar usuário com email já usado respondia 500 (P2002 não tratado).
 * Esperado (RF-09): 409, com mensagem string dizendo que o email já está em uso.
 *
 * Sobe o AppModule real com o AllExceptionsFilter (como no main.ts), num SQLite
 * descartável criado a partir das migrations. O prisma/dev.db não é tocado.
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
    fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-email-dup-')),
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

describe('Email duplicado responde 409', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let idOutro: number;

  beforeEach(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }),
    });
    const autenticado = await prisma.usuarios.create({
      data: { nome: 'Autenticado', email: 'auth@teste.com', senha: '$2b$10$hashqualquer', isAdmin: true }, // SPEC-021: admin (RF-82)
    });
    const outro = await prisma.usuarios.create({
      data: { nome: 'Outro', email: 'outro@teste.com', senha: '$2b$10$hashqualquer' },
    });
    idOutro = outro.id;

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

  it('POST /usuarios com email já usado → 409 com mensagem string, e nada é gravado', async () => {
    const antes = await prisma.usuarios.count();
    const res = await request(app.getHttpServer())
      .post('/usuarios')
      .set('Authorization', `Bearer ${token}`) // SPEC-021: o cadastro exige admin (RF-82)
      .send({ nome: 'Repetido', email: 'outro@teste.com', senha: '123456' });
    expect(res.status).toBe(409);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message).toMatch(/email/i);
    expect(await prisma.usuarios.count()).toBe(antes);
  });

  it('PATCH /usuarios/:id trocando para email de outro → 409, e o email não muda', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/usuarios/${idOutro}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'auth@teste.com' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Este email já está em uso por outro usuário');
    const outro = await prisma.usuarios.findUnique({ where: { id: idOutro } });
    expect(outro?.email).toBe('outro@teste.com');
  });

  it('não regride: POST /usuarios com email novo continua 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/usuarios')
      .set('Authorization', `Bearer ${token}`) // SPEC-021: o cadastro exige admin (RF-82)
      .send({ nome: 'Novo', email: 'novo@teste.com', senha: '123456' });
    expect(res.status).toBe(201);
  });

  it('não regride: membro repetido continua 409 com a mensagem própria', async () => {
    const status = await prisma.statusProjeto.findFirst();
    const projeto = await prisma.projetos.create({
      data: { nome: 'P', idStatus: status!.id },
    });
    const url = `/projetos/${projeto.id}/membros`;
    const auth = { Authorization: `Bearer ${token}` };
    await request(app.getHttpServer()).post(url).set(auth).send({ idUsuario: idOutro }).expect(201);
    const res = await request(app.getHttpServer()).post(url).set(auth).send({ idUsuario: idOutro });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('O usuário já é membro deste projeto');
  });
});
