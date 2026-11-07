/**
 * SPEC-002: apagar algo que está em uso explica o motivo.
 *
 * CA cobertos: CA-B1, CA-B2, CA-B3, CA-R1, CA-R2, CA-R3, CA-R4.
 *
 * Sobe o AppModule real (guard JWT e ValidationPipe globais) com o AllExceptionsFilter
 * registrado como no main.ts. O banco é um SQLite descartável, criado a cada teste a
 * partir da migration do projeto. O prisma/dev.db não é tocado.
 */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { ArgumentsHost, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, PrismaClient } from '@prisma/client';
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
    fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec002-')),
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

describe('SPEC-002: apagar registro em uso', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let ids: {
    usuarioCriador: number;
    usuarioComentarista: number;
    projetoComTarefa: number;
    tarefa: number;
    labelEmUso: number;
    labelSemUso: number;
  };

  beforeEach(async () => {
    const arquivo = criarBancoDescartavel();
    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: arquivo }),
    });

    // Cenário mínimo da reprodução: etiqueta aplicada a uma tarefa, projeto com tarefa,
    // usuário que criou tarefa e usuário que só comentou.
    const criador = await prisma.usuarios.create({
      data: { nome: 'Criador', email: 'criador@teste.com', senha: 'x' },
    });
    const comentarista = await prisma.usuarios.create({
      data: { nome: 'Comentarista', email: 'coment@teste.com', senha: 'x' },
    });
    const projeto = await prisma.projetos.create({
      data: { nome: 'Projeto', idStatus: 1 },
    });
    const tarefa = await prisma.tarefas.create({
      data: {
        nome: 'Tarefa',
        idStatus: 1,
        prioridade: 'Alta',
        idUsuarioCriador: criador.id,
        idProjeto: projeto.id,
      },
    });
    const labelEmUso = await prisma.labels.create({ data: { nome: 'back-end' } });
    const labelSemUso = await prisma.labels.create({ data: { nome: 'sem uso' } });
    await prisma.labelsTarefas.create({
      data: { idLabel: labelEmUso.id, idTarefa: tarefa.id },
    });
    await prisma.comentariosTarefas.create({
      data: { comentario: 'oi', idTarefa: tarefa.id, idUsuario: comentarista.id },
    });

    ids = {
      usuarioCriador: criador.id,
      usuarioComentarista: comentarista.id,
      projetoComTarefa: projeto.id,
      tarefa: tarefa.id,
      labelEmUso: labelEmUso.id,
      labelSemUso: labelSemUso.id,
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    await app.init();

    token = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: criador.id, email: criador.email },
      { expiresIn: '1h' },
    );
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const del = (url: string) =>
    request(app.getHttpServer())
      .delete(url)
      .set('Authorization', `Bearer ${token}`);

  function esperaConflitoEmUso(res: request.Response) {
    expect({ status: res.status, body: res.body }).toMatchObject({
      status: 409,
      body: { statusCode: 409 },
    });
    expect(Object.keys(res.body).sort()).toEqual(['message', 'statusCode']);
    expect(res.body.statusCode).toBe(409);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message).toMatch(/em uso/i);
  }

  // ---------- Pré-condição: o motivo da falha é P2003 vindo do banco ----------

  it('pré-condição: o banco recusa apagar etiqueta em uso com P2003 (FK RESTRICT)', async () => {
    await expect(
      prisma.labels.delete({ where: { id: ids.labelEmUso } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  // ---------- CA-B ----------

  it('CA-B1: DELETE /labels/:id de etiqueta em uso responde 409 explicando que está em uso', async () => {
    const res = await del(`/labels/${ids.labelEmUso}`);
    esperaConflitoEmUso(res);
    expect(await prisma.labels.findUnique({ where: { id: ids.labelEmUso } })).not.toBeNull();
  });

  it('CA-B2: DELETE /projetos/:id de projeto com tarefas responde 409', async () => {
    const res = await del(`/projetos/${ids.projetoComTarefa}`);
    esperaConflitoEmUso(res);
    expect(await prisma.projetos.findUnique({ where: { id: ids.projetoComTarefa } })).not.toBeNull();
  });

  it('CA-B3: DELETE /usuarios/:id de usuário que criou tarefa responde 409', async () => {
    const res = await del(`/usuarios/${ids.usuarioCriador}`);
    esperaConflitoEmUso(res);
  });

  it('CA-B3: DELETE /usuarios/:id de usuário que comentou responde 409', async () => {
    const res = await del(`/usuarios/${ids.usuarioComentarista}`);
    esperaConflitoEmUso(res);
  });

  // ---------- CA-R ----------

  it('CA-R1: apagar etiqueta sem uso continua respondendo 200', async () => {
    const res = await del(`/labels/${ids.labelSemUso}`);
    expect(res.status).toBe(200);
    expect(await prisma.labels.findUnique({ where: { id: ids.labelSemUso } })).toBeNull();
  });

  it('CA-R2: apagar tarefa remove vínculos de etiqueta e comentários junto', async () => {
    const res = await del(`/tarefas/${ids.tarefa}`);
    expect(res.status).toBe(200);
    expect(await prisma.tarefas.count({ where: { id: ids.tarefa } })).toBe(0);
    expect(await prisma.labelsTarefas.count({ where: { idTarefa: ids.tarefa } })).toBe(0);
    expect(await prisma.comentariosTarefas.count({ where: { idTarefa: ids.tarefa } })).toBe(0);
  });

  it('CA-R3: P2025 continua respondendo 404 Registro não encontrado', async () => {
    const res = await del('/labels/9999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, message: 'Registro não encontrado' });
  });

  it('CA-R4: HttpException (validação) continua no formato { statusCode, message }', async () => {
    const res = await request(app.getHttpServer())
      .post('/labels')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'statusCode']);
    expect(res.body.statusCode).toBe(400);
  });
});

describe('SPEC-002: AllExceptionsFilter isolado (CA-R4)', () => {
  function executar(exception: unknown) {
    const saida: { status?: number; body?: unknown } = {};
    const response = {
      status(s: number) {
        saida.status = s;
        return this;
      },
      json(b: unknown) {
        saida.body = b;
        return this;
      },
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
    return saida;
  }

  it('CA-R4: exceção que não é do Prisma continua 500 { statusCode, message }', () => {
    expect(executar(new Error('boom'))).toEqual({
      status: 500,
      body: { statusCode: 500, message: 'Erro interno do servidor' },
    });
  });

  // Amostra trocada de P2002 para P2000 em 06/11/2026: P2002 (campo único) passou a ser
  // tratado (409, correção do email duplicado). O CA-R4 continua o mesmo: código não tratado → 500.
  it('CA-R4: erro do Prisma de outro código (P2000) continua no 500 genérico', () => {
    const e = new Prisma.PrismaClientKnownRequestError('valor longo demais', {
      code: 'P2000',
      clientVersion: 'test',
    });
    expect(executar(e)).toEqual({
      status: 500,
      body: { statusCode: 500, message: 'Erro interno do servidor' },
    });
  });
});
