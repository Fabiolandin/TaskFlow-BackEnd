/**
 * SPEC-020: label tem cor (RF-76) e a tarefa devolve a cor da label (RF-32).
 *
 * CA cobertos: CA-20, CA-21 (entrego) e CA-R5 (não-regrido). O CA-R8 é a suíte das specs
 * 006, 016 e 019, que segue verde com a lista de chaves da label acrescida de `cor`.
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
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec020-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

describe('SPEC-020: cor de label', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }) });
    const usuario = await prisma.usuarios.create({ data: { nome: 'Teste', email: 'teste@teste.com', senha: 'x' } });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    await app.init();

    token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: usuario.id, email: usuario.email }, { expiresIn: '1h' });
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
  const contar = async () => ((await http().get('/labels')).body as unknown[]).length;

  it('CA-20: POST com cor hex grava e devolve a cor', async () => {
    const res = await http().post('/labels', { nome: 'frontend', cor: '#7FD1A6' });
    expect(res.status).toBe(201);
    expect(res.body.cor).toBe('#7FD1A6');
  });

  it.each(['verde', '7FD1A6', '#7FD1A', '#7FD1A6FF'])('CA-20: POST com cor "%s" responde 400 e não grava', async (cor) => {
    const antes = await contar();
    const res = await http().post('/labels', { nome: 'x', cor });
    expect(res.status).toBe(400);
    expect(await contar()).toBe(antes);
  });

  it('CA-20: cor "" grava null; PATCH troca, rejeita inválida e limpa com "" e null', async () => {
    const vazio = await http().post('/labels', { nome: 'vazio', cor: '' });
    expect(vazio.status).toBe(201);
    expect(vazio.body.cor).toBeNull();

    const base = (await http().post('/labels', { nome: 'base', cor: '#112233' })).body;
    const troca = await http().patch(`/labels/${base.id}`, { cor: '#9BB8F0' });
    expect(troca.status).toBe(200);
    expect(troca.body.cor).toBe('#9BB8F0');

    const invalida = await http().patch(`/labels/${base.id}`, { cor: 'azul' });
    expect(invalida.status).toBe(400);
    expect((await http().get(`/labels/${base.id}`)).body.cor).toBe('#9BB8F0');

    for (const limpa of ['', null]) {
      await http().patch(`/labels/${base.id}`, { cor: '#9BB8F0' });
      const res = await http().patch(`/labels/${base.id}`, { cor: limpa });
      expect(res.status).toBe(200);
      expect(res.body.cor).toBeNull();
    }
  });

  it('CA-21: GET /labels e a label dentro da tarefa devolvem cor', async () => {
    const label = (await http().post('/labels', { nome: 'backend', cor: '#9BB8F0' })).body;
    const lista = (await http().get('/labels')).body as { id: number; cor: string | null }[];
    expect(lista.find((l) => l.id === label.id)?.cor).toBe('#9BB8F0');

    const statusP = await prisma.statusProjeto.create({ data: { nome: 'Ativo', ordem: 1 } });
    const statusT = await prisma.statusTarefa.create({ data: { nome: 'A fazer', ordem: 1 } });
    const projeto = (await http().post('/projetos', { nome: 'P', idStatus: statusP.id })).body;
    const criada = await http().post('/tarefas', { nome: 'T', idStatus: statusT.id, prioridade: 'Alta', idProjeto: projeto.id, labelIds: [label.id] });
    expect(criada.status).toBe(201);
    const esperado = [{ id: label.id, nome: 'backend', cor: '#9BB8F0' }];
    expect(criada.body.labels).toEqual(esperado);
    expect((await http().get(`/tarefas/${criada.body.id}`)).body.labels).toEqual(esperado);
    expect((await http().get('/tarefas')).body.data[0].labels).toEqual(esperado);
  });

  it('CA-R5: criar e editar label sem cor segue funcionando', async () => {
    const criada = await http().post('/labels', { nome: 'sem cor' });
    expect(criada.status).toBe(201);
    expect(criada.body.cor ?? null).toBeNull();
    const editada = await http().patch(`/labels/${criada.body.id}`, { nome: 'renomeada' });
    expect(editada.status).toBe(200);
    expect(editada.body.nome).toBe('renomeada');
  });
});
