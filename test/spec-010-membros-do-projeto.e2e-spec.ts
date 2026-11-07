/**
 * SPEC-010: projeto passa a ter membros, e o responsável pela tarefa sai dessa lista.
 *
 * CA cobertos: CA-01 a CA-08 (entrego) e CA-12 a CA-16 (não-regrido).
 *
 * Sobe o AppModule real (guard JWT e ValidationPipe globais) com o AllExceptionsFilter
 * registrado como no main.ts. O banco é um SQLite descartável, criado a cada teste a
 * partir das migrations do projeto. O prisma/dev.db não é tocado.
 *
 * CA-08 reproduz o backfill: monta o banco só com as migrations anteriores à SPEC-010,
 * grava um retrato dos dados de hoje (usuário 1 criador das tarefas do projeto 1, nenhum
 * membro) e aplica as migrations seguintes por cima.
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
// Última migration que existia antes da SPEC-010.
const ULTIMA_ANTES_DA_010 = '20261106013500_status_vira_cadastro';

function pastasDeMigration(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .sort()
    .filter((p) => fs.existsSync(path.join(MIGRATIONS_DIR, p, 'migration.sql')));
}

function aplicar(db: Database.Database, pastas: string[]) {
  for (const pasta of pastas) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, pasta, 'migration.sql'), 'utf8'));
  }
}

function arquivoTemporario(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec010-')), 'test.db');
}

describe('SPEC-010: membros do projeto', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokenDono: string;
  let tokenOutro: string;
  let ids: {
    dono: number;
    membro: number;
    naoMembro: number;
    projeto: number;
    outroProjeto: number;
    tarefa: number;
  };

  beforeEach(async () => {
    const arquivo = arquivoTemporario();
    const db = new Database(arquivo);
    aplicar(db, pastasDeMigration());
    db.close();

    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: arquivo }) });

    const dono = await prisma.usuarios.create({
      data: { nome: 'Dono', email: 'dono@teste.com', senha: 'hash-secreto' },
    });
    const membro = await prisma.usuarios.create({
      data: { nome: 'Membro', email: 'membro@teste.com', senha: 'hash-secreto' },
    });
    const naoMembro = await prisma.usuarios.create({
      data: { nome: 'Fora', email: 'fora@teste.com', senha: 'hash-secreto' },
    });
    const projeto = await prisma.projetos.create({ data: { nome: 'Projeto', idStatus: 1 } });
    const outroProjeto = await prisma.projetos.create({
      data: { nome: 'Outro', idStatus: 1 },
    });
    await prisma.usuariosProjetos.create({
      data: { idUsuario: membro.id, idProjeto: projeto.id },
    });
    const tarefa = await prisma.tarefas.create({
      data: {
        nome: 'Tarefa sem responsável',
        idStatus: 1,
        prioridade: 'Alta',
        idUsuarioCriador: dono.id,
        idProjeto: projeto.id,
      },
    });

    ids = {
      dono: dono.id,
      membro: membro.id,
      naoMembro: naoMembro.id,
      projeto: projeto.id,
      outroProjeto: outroProjeto.id,
      tarefa: tarefa.id,
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter()); // como em src/main.ts
    await app.init();

    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    tokenDono = jwt.sign({ sub: dono.id, email: dono.email }, { expiresIn: '1h' });
    tokenOutro = jwt.sign({ sub: naoMembro.id, email: naoMembro.email }, { expiresIn: '1h' });
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = (token = tokenDono) => {
    const s = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(s.get(url)),
      post: (url: string, body: object) => auth(s.post(url).send(body)),
      patch: (url: string, body: object) => auth(s.patch(url).send(body)),
      delete: (url: string) => auth(s.delete(url)),
    };
  };

  const novaTarefa = (extra: object = {}) => ({
    nome: 'Nova',
    idStatus: 1,
    prioridade: 'Baixa',
    idProjeto: ids.projeto,
    ...extra,
  });

  function semSenha(valor: unknown) {
    expect(JSON.stringify(valor)).not.toMatch(/senha|hash-secreto/);
  }

  function esperaErroComMotivo(res: request.Response, status: number, motivo: RegExp) {
    expect(res.status).toBe(status);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'statusCode']);
    expect(res.body.statusCode).toBe(status);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message).toMatch(motivo);
  }

  const membrosNoBanco = (idProjeto: number) =>
    prisma.usuariosProjetos.count({ where: { idProjeto } });

  // ---------- Entrego ----------

  it('CA-01: GET /projetos/:id/membros lista os membros do projeto, sem senha', async () => {
    const res = await http().get(`/projetos/${ids.projeto}/membros`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: ids.membro, nome: 'Membro', email: 'membro@teste.com' }]);
    semSenha(res.body);

    const vazio = await http().get(`/projetos/${ids.outroProjeto}/membros`);
    expect(vazio.status).toBe(200);
    expect(vazio.body).toEqual([]);
  });

  it('CA-02: POST /projetos/:id/membros adiciona; adicionar o mesmo de novo é recusado', async () => {
    const res = await http().post(`/projetos/${ids.projeto}/membros`, { idUsuario: ids.dono });
    expect(res.status).toBe(201);
    semSenha(res.body);

    const lista = await http().get(`/projetos/${ids.projeto}/membros`);
    expect(lista.body.map((u: { id: number }) => u.id).sort()).toEqual(
      [ids.dono, ids.membro].sort(),
    );

    const repetido = await http().post(`/projetos/${ids.projeto}/membros`, {
      idUsuario: ids.dono,
    });
    esperaErroComMotivo(repetido, 409, /membro/i);
    expect(await membrosNoBanco(ids.projeto)).toBe(2);
  });

  it('CA-03: DELETE /projetos/:id/membros/:idUsuario remove o membro', async () => {
    const res = await http().delete(`/projetos/${ids.projeto}/membros/${ids.membro}`);
    expect(res.status).toBe(200);
    semSenha(res.body);
    expect(await membrosNoBanco(ids.projeto)).toBe(0);
  });

  it('CA-04: GET /projetos e GET /projetos/:id trazem os membros de cada projeto', async () => {
    const lista = await http().get('/projetos');
    expect(lista.status).toBe(200);
    const porId = Object.fromEntries(
      lista.body.data.map((p: { id: number; membros: unknown }) => [p.id, p.membros]),
    );
    expect(porId[ids.projeto]).toEqual([
      { id: ids.membro, nome: 'Membro', email: 'membro@teste.com' },
    ]);
    expect(porId[ids.outroProjeto]).toEqual([]);
    semSenha(lista.body);

    const um = await http().get(`/projetos/${ids.projeto}`);
    expect(um.status).toBe(200);
    expect(um.body.membros).toEqual([
      { id: ids.membro, nome: 'Membro', email: 'membro@teste.com' },
    ]);
    semSenha(um.body);
  });

  it('CA-05: criar tarefa com responsável que não é membro é recusado, dizendo o motivo', async () => {
    const antes = await prisma.tarefas.count();
    const res = await http().post('/tarefas', novaTarefa({ idUsuarioResponsavel: ids.naoMembro }));
    esperaErroComMotivo(res, 400, /membro/i);
    expect(await prisma.tarefas.count()).toBe(antes);

    const ok = await http().post('/tarefas', novaTarefa({ idUsuarioResponsavel: ids.membro }));
    expect(ok.status).toBe(201);
    expect(ok.body.idUsuarioResponsavel).toBe(ids.membro);
  });

  it('CA-06: o mesmo vale no PATCH da tarefa', async () => {
    const res = await http().patch(`/tarefas/${ids.tarefa}`, {
      idUsuarioResponsavel: ids.naoMembro,
    });
    esperaErroComMotivo(res, 400, /membro/i);
    expect(
      (await prisma.tarefas.findUnique({ where: { id: ids.tarefa } }))?.idUsuarioResponsavel,
    ).toBeNull();

    const ok = await http().patch(`/tarefas/${ids.tarefa}`, { idUsuarioResponsavel: ids.membro });
    expect(ok.status).toBe(200);
    expect(ok.body.idUsuarioResponsavel).toBe(ids.membro);

    // Mover a tarefa para um projeto onde o responsável não é membro também é recusado.
    const mover = await http().patch(`/tarefas/${ids.tarefa}`, { idProjeto: ids.outroProjeto });
    esperaErroComMotivo(mover, 400, /membro/i);
    expect((await prisma.tarefas.findUnique({ where: { id: ids.tarefa } }))?.idProjeto).toBe(
      ids.projeto,
    );
  });

  it('CA-07: remover membro que é responsável por tarefa no projeto é recusado, explicando', async () => {
    await prisma.tarefas.update({
      where: { id: ids.tarefa },
      data: { idUsuarioResponsavel: ids.membro },
    });
    const res = await http().delete(`/projetos/${ids.projeto}/membros/${ids.membro}`);
    esperaErroComMotivo(res, 409, /respons[áa]vel/i);
    expect(await membrosNoBanco(ids.projeto)).toBe(1);
  });

  // ---------- Não-regrido ----------

  it('CA-12: outro autenticado continua vendo todos os projetos e todas as tarefas', async () => {
    const projetos = await http(tokenOutro).get('/projetos');
    expect(projetos.status).toBe(200);
    expect(projetos.body.total).toBe(await prisma.projetos.count());

    const tarefas = await http(tokenOutro).get('/tarefas');
    expect(tarefas.status).toBe(200);
    // emenda SPEC-006 (D-1): GET /tarefas agora é o envelope paginado
    expect(tarefas.body.total).toBe(await prisma.tarefas.count());

    const um = await http(tokenOutro).get(`/projetos/${ids.projeto}`);
    expect(um.status).toBe(200);
  });

  it('CA-13: idUsuarioResponsavel continua opcional (criar sem, e tirar no PATCH)', async () => {
    const criada = await http().post('/tarefas', novaTarefa());
    expect(criada.status).toBe(201);
    expect(criada.body.idUsuarioResponsavel).toBeNull();

    const tirar = await http().patch(`/tarefas/${ids.tarefa}`, { idUsuarioResponsavel: null });
    expect(tirar.status).toBe(200);
    expect(tirar.body.idUsuarioResponsavel).toBeNull();
  });

  it('CA-14: tarefa existente sem responsável continua válida (lê e edita)', async () => {
    const lida = await http().get(`/tarefas/${ids.tarefa}`);
    expect(lida.status).toBe(200);
    const editada = await http().patch(`/tarefas/${ids.tarefa}`, { nome: 'Renomeada' });
    expect(editada.status).toBe(200);
    expect(editada.body.nome).toBe('Renomeada');
  });

  it('CA-15: GET /projetos continua paginado no envelope { data, total, page, totalPages }', async () => {
    const res = await http().get('/projetos?page=1&limit=1');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'page', 'total', 'totalPages']);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBe(2);
  });

  it('CA-16: criar tarefa continua exigindo projeto, e o criador vem do token', async () => {
    const semProjeto = await http().post('/tarefas', {
      nome: 'X',
      idStatus: 1,
      prioridade: 'Baixa',
    });
    expect(semProjeto.status).toBe(400);

    const criada = await http(tokenOutro).post('/tarefas', novaTarefa());
    expect(criada.status).toBe(201);
    expect(criada.body.idUsuarioCriador).toBe(ids.naoMembro);
  });
});

describe('SPEC-010: backfill (CA-08)', () => {
  it('CA-08: após a migration, o usuário 1 é membro do projeto 1', () => {
    const db = new Database(arquivoTemporario());
    const pastas = pastasDeMigration();
    aplicar(db, pastas.filter((p) => p <= ULTIMA_ANTES_DA_010));

    // Retrato do dev.db: usuário 1 criou as tarefas do projeto 1; ninguém é membro.
    db.exec(`
      INSERT INTO Usuarios (id, nome, email, senha, updatedAt) VALUES
        (1, 'Usuario1', 'u1@teste.com', 'x', CURRENT_TIMESTAMP),
        (2, 'Usuario2', 'u2@teste.com', 'x', CURRENT_TIMESTAMP);
      INSERT INTO Projetos (id, nome, idStatus, updatedAt) VALUES
        (1, 'Projeto1', 1, CURRENT_TIMESTAMP),
        (2, 'Projeto2', 1, CURRENT_TIMESTAMP);
      INSERT INTO Tarefas (nome, idStatus, prioridade, idUsuarioCriador, idProjeto, updatedAt) VALUES
        ('t1', 1, 'Alta', 1, 1, CURRENT_TIMESTAMP),
        ('t2', 1, 'Alta', 1, 1, CURRENT_TIMESTAMP);
    `);
    expect(db.prepare('SELECT COUNT(*) c FROM UsuariosProjetos').get()).toEqual({ c: 0 });

    aplicar(db, pastas.filter((p) => p > ULTIMA_ANTES_DA_010));

    expect(
      db.prepare('SELECT idUsuario, idProjeto FROM UsuariosProjetos').all(),
    ).toEqual([{ idUsuario: 1, idProjeto: 1 }]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('CA-08: o backfill não cria FK órfã quando o usuário 1 ou o projeto 1 não existem', () => {
    const db = new Database(arquivoTemporario());
    const pastas = pastasDeMigration();
    expect(pastas.some((p) => p > ULTIMA_ANTES_DA_010)).toBe(true);

    // Banco vazio: nenhuma das duas pontas existe.
    aplicar(db, pastas);
    expect(db.prepare('SELECT COUNT(*) c FROM UsuariosProjetos').get()).toEqual({ c: 0 });

    // Só o usuário 1 existe; o projeto 1 não.
    const db2 = new Database(arquivoTemporario());
    aplicar(db2, pastas.filter((p) => p <= ULTIMA_ANTES_DA_010));
    db2.exec(
      `INSERT INTO Usuarios (id, nome, email, senha, updatedAt) VALUES (1, 'U', 'u@t.com', 'x', CURRENT_TIMESTAMP);`,
    );
    db2.pragma('foreign_keys = OFF'); // o backfill não pode depender da FK para não criar órfã
    aplicar(db2, pastas.filter((p) => p > ULTIMA_ANTES_DA_010));
    expect(db2.prepare('SELECT COUNT(*) c FROM UsuariosProjetos').get()).toEqual({ c: 0 });
    expect(db2.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    db.close();
    db2.close();
  });
});
