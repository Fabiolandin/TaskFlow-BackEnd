/**
 * SPEC-003a: status vira cadastro; prioridade vira conjunto fixo.
 *
 * CA cobertos: CA-01 a CA-07 (entrego) e CA-08 a CA-11 (não-regrido).
 *
 * Sobe o AppModule real (guard JWT e ValidationPipe globais) com o AllExceptionsFilter
 * registrado como no main.ts. O banco é um SQLite descartável, criado a cada teste a
 * partir das migrations do projeto. O prisma/dev.db não é tocado.
 *
 * O arquivo precisa compilar antes e depois da feature (os não-regrido rodam nos dois
 * momentos). Por isso não usa os tipos gerados dos models novos: o acesso aos cadastros
 * é pela API ou por SQL, e o nome da coluna de status (`status` antes, `idStatus` depois)
 * é detectado no banco.
 *
 * CA-08 e CA-09 reproduzem a migração de dados: montam o banco só com a migration
 * original, gravam um retrato dos dados de hoje (status 1 e 2; prioridade "alta" e
 * "baixa") e aplicam as migrations seguintes por cima.
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
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec003a-')), 'test.db');
}

function colunas(db: Database.Database, tabela: string): string[] {
  return (db.prepare(`PRAGMA table_info("${tabela}")`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

describe('SPEC-003a: status vira cadastro', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let arquivo: string;
  let token: string;
  let campoStatus: 'status' | 'idStatus';
  let ids: { usuario: number; projeto: number; tarefa: number };

  beforeEach(async () => {
    arquivo = arquivoTemporario();
    const db = new Database(arquivo);
    aplicar(db, pastasDeMigration());
    campoStatus = colunas(db, 'Tarefas').includes('idStatus') ? 'idStatus' : 'status';
    db.close();

    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: arquivo }) });

    const usuario = await prisma.usuarios.create({
      data: { nome: 'Teste', email: 'teste@teste.com', senha: 'x' },
    });
    const projeto = await prisma.projetos.create({
      data: { nome: 'Projeto', [campoStatus]: 1 } as any,
    });
    const tarefa = await prisma.tarefas.create({
      data: {
        nome: 'Existente',
        [campoStatus]: 1,
        prioridade: 'Alta',
        idUsuarioCriador: usuario.id,
        idProjeto: projeto.id,
      } as any,
    });
    ids = { usuario: usuario.id, projeto: projeto.id, tarefa: tarefa.id };

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
      delete: (url: string) => auth(request(server).delete(url)),
    };
  };

  const tarefa = (extra: object) => ({ nome: 'Nova', idProjeto: ids.projeto, ...extra });

  const recusado = (status: number) => {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  };

  // ---------- Entrego ----------

  it('CA-01: existem StatusProjeto e StatusTarefa com nome, cor, ordem e isFinal', () => {
    const db = new Database(arquivo, { readonly: true });
    for (const tabela of ['StatusProjeto', 'StatusTarefa']) {
      expect(colunas(db, tabela)).toEqual(
        expect.arrayContaining(['id', 'nome', 'cor', 'ordem', 'isFinal']),
      );
    }
    db.close();
  });

  it('CA-02: projeto com idStatus inexistente é recusado; com idStatus válido grava', async () => {
    const antes = await prisma.projetos.count();
    const ruim = await http().post('/projetos', { nome: 'P', idStatus: 99 });
    recusado(ruim.status);
    expect(await prisma.projetos.count()).toBe(antes);

    const bom = await http().post('/projetos', { nome: 'P', idStatus: 2 });
    expect(bom.status).toBe(201);
    expect(bom.body.idStatus).toBe(2);
  });

  it('CA-03: tarefa com idStatus inexistente é recusada; com idStatus válido grava', async () => {
    const antes = await prisma.tarefas.count();
    const ruim = await http().post('/tarefas', tarefa({ idStatus: 99, prioridade: 'Alta' }));
    recusado(ruim.status);
    expect(await prisma.tarefas.count()).toBe(antes);

    const bom = await http().post('/tarefas', tarefa({ idStatus: 3, prioridade: 'Alta' }));
    expect(bom.status).toBe(201);
    expect(bom.body.idStatus).toBe(3);
  });

  it('CA-04: as chaves estrangeiras apontam cada uma para o seu cadastro', () => {
    const db = new Database(arquivo, { readonly: true });
    const fk = (tabela: string) =>
      (db.prepare(`PRAGMA foreign_key_list("${tabela}")`).all() as {
        table: string;
        from: string;
      }[]).find((f) => f.from === 'idStatus')?.table;
    expect(fk('Tarefas')).toBe('StatusTarefa');
    expect(fk('Projetos')).toBe('StatusProjeto');
    db.close();
  });

  it('CA-04: tarefa não recebe id que só existe em StatusProjeto, e vice-versa', async () => {
    // 5 (Cancelado) existe em StatusProjeto e não em StatusTarefa (1 a 4).
    const t = await http().post('/tarefas', tarefa({ idStatus: 5, prioridade: 'Alta' }));
    recusado(t.status);

    // Cria dois status de tarefa (ids 5 e 6); o 6 não existe em StatusProjeto (1 a 5).
    await http().post('/statustarefa', { nome: 'Extra 1', ordem: 5 });
    const extra = await http().post('/statustarefa', { nome: 'Extra 2', ordem: 6 });
    expect(extra.status).toBe(201);
    const idSoDeTarefa = extra.body.id;
    const existeEmProjeto = await http().get(`/statusprojeto/${idSoDeTarefa}`);
    expect(existeEmProjeto.status).toBe(404);

    const p = await http().post('/projetos', { nome: 'P', idStatus: idSoDeTarefa });
    recusado(p.status);
  });

  it('CA-05: prioridade fora de Baixa/Média/Alta/Urgente é recusada com 400', async () => {
    for (const prioridade of ['urgentissima', 'alta', 'ALTA', '']) {
      const res = await http().post('/tarefas', tarefa({ idStatus: 1, prioridade }));
      expect(res.status).toBe(400);
    }
    for (const prioridade of ['Baixa', 'Média', 'Alta', 'Urgente']) {
      const res = await http().post('/tarefas', tarefa({ idStatus: 1, prioridade }));
      expect(res.status).toBe(201);
      expect(res.body.prioridade).toBe(prioridade);
    }
  });

  it('CA-05: as prioridades já gravadas são normalizadas pela migration', () => {
    const db = retratoMigrado();
    const linhas = db
      .prepare('SELECT prioridade, count(*) n FROM Tarefas GROUP BY prioridade ORDER BY prioridade')
      .all();
    expect(linhas).toEqual([
      { prioridade: 'Alta', n: 5 },
      { prioridade: 'Baixa', n: 1 },
    ]);
    db.close();
  });

  for (const rota of ['statusprojeto', 'statustarefa']) {
    it(`CA-06: /${rota} responde a GET, POST, PATCH e DELETE, como labels`, async () => {
      const lista = await http().get(`/${rota}`);
      expect(lista.status).toBe(200);
      expect(Array.isArray(lista.body)).toBe(true);
      expect(lista.body.length).toBeGreaterThan(0);

      const criado = await http().post(`/${rota}`, {
        nome: 'Novo',
        cor: '#123456',
        ordem: 9,
        isFinal: true,
      });
      expect(criado.status).toBe(201);
      expect(criado.body).toMatchObject({ nome: 'Novo', cor: '#123456', ordem: 9, isFinal: true });
      const id = criado.body.id;

      const um = await http().get(`/${rota}/${id}`);
      expect(um.status).toBe(200);
      expect(um.body.nome).toBe('Novo');

      const editado = await http().patch(`/${rota}/${id}`, { nome: 'Renomeado' });
      expect(editado.status).toBe(200);
      expect(editado.body.nome).toBe('Renomeado');

      const apagado = await http().delete(`/${rota}/${id}`);
      expect(apagado.status).toBe(200);
      expect((await http().get(`/${rota}/${id}`)).status).toBe(404);

      // Validação do corpo, como em labels: sem nome é 400.
      expect((await http().post(`/${rota}`, { ordem: 1 })).status).toBe(400);
    });
  }

  it('CA-06: status em uso não é apagado (409, como labels)', async () => {
    expect((await http().delete('/statusprojeto/1')).status).toBe(409);
    expect((await http().delete('/statustarefa/1')).status).toBe(409);
  });

  it('CA-07: GET /tarefas/:id devolve o status como objeto (nome, cor)', async () => {
    const res = await http().get(`/tarefas/${ids.tarefa}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.status).toBe('object');
    expect(res.body.status).toMatchObject({ nome: 'A Fazer' });
    expect(res.body.status).toHaveProperty('cor');
  });

  // ---------- Não-regrido ----------

  /**
   * Banco só com a migration original + o retrato dos dados de hoje (10 projetos com
   * status 1; 6 tarefas: status 1 x4 e 2 x2; prioridade "alta" x5 e "baixa" x1),
   * e depois as migrations seguintes. Antes da feature, "as seguintes" é nenhuma.
   */
  const RETRATO_TAREFAS = [
    { status: 1, prioridade: 'alta' },
    { status: 1, prioridade: 'alta' },
    { status: 1, prioridade: 'alta' },
    { status: 1, prioridade: 'alta' },
    { status: 2, prioridade: 'alta' },
    { status: 2, prioridade: 'baixa' },
  ];

  function retratoMigrado(): Database.Database {
    const [original, ...seguintes] = pastasDeMigration();
    const db = new Database(arquivoTemporario());
    aplicar(db, [original]);
    const agora = new Date().toISOString();
    db.prepare(
      'INSERT INTO Usuarios (nome, email, senha, updatedAt) VALUES (?, ?, ?, ?)',
    ).run('U', 'u@teste.com', 'x', agora);
    const projeto = db.prepare(
      'INSERT INTO Projetos (nome, status, updatedAt) VALUES (?, 1, ?)',
    );
    for (let i = 1; i <= 10; i++) projeto.run(`Projeto ${i}`, agora);
    const t = db.prepare(
      'INSERT INTO Tarefas (nome, status, prioridade, updatedAt, idUsuarioCriador, idProjeto) VALUES (?, ?, ?, ?, 1, 1)',
    );
    RETRATO_TAREFAS.forEach((r, i) => t.run(`Tarefa ${i + 1}`, r.status, r.prioridade, agora));
    aplicar(db, seguintes);
    return db;
  }

  function colunaStatus(db: Database.Database, tabela: string) {
    return colunas(db, tabela).includes('idStatus') ? 'idStatus' : 'status';
  }

  it('CA-08: os projetos existentes continuam existindo, com status válido', () => {
    const db = retratoMigrado();
    const c = colunaStatus(db, 'Projetos');
    const linhas = db.prepare(`SELECT ${c} AS s FROM Projetos ORDER BY id`).all() as {
      s: number;
    }[];
    expect(linhas).toHaveLength(10);
    expect(linhas.every((l) => l.s === 1)).toBe(true);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('CA-09: as tarefas existentes continuam existindo, com status e prioridade válidos', () => {
    const db = retratoMigrado();
    const c = colunaStatus(db, 'Tarefas');
    const linhas = db
      .prepare(`SELECT ${c} AS s, prioridade FROM Tarefas ORDER BY id`)
      .all() as { s: number; prioridade: string }[];
    expect(linhas).toHaveLength(6);
    linhas.forEach((l, i) => {
      expect(l.s).toBe(RETRATO_TAREFAS[i].status);
      expect(l.prioridade.toLowerCase()).toBe(RETRATO_TAREFAS[i].prioridade);
    });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('CA-10: GET /projetos continua paginado, no envelope { data, total, page, totalPages }', async () => {
    for (let i = 0; i < 4; i++) {
      await prisma.projetos.create({ data: { nome: `Extra ${i}`, [campoStatus]: 1 } as any });
    }
    const res = await http().get('/projetos?page=2&limit=2');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'page', 'total', 'totalPages']);
    expect(res.body.total).toBe(5);
    expect(res.body.page).toBe(2);
    expect(res.body.totalPages).toBe(3);
    expect(res.body.data).toHaveLength(2);
  });

  it('CA-11: toda tarefa continua tendo projeto e criador obrigatórios', async () => {
    const corpo = { nome: 'T', [campoStatus]: 1, prioridade: 'Alta' };
    const semProjeto = await http().post('/tarefas', corpo);
    expect(semProjeto.status).toBe(400);

    const ok = await http().post('/tarefas', { ...corpo, idProjeto: ids.projeto });
    expect(ok.status).toBe(201);
    expect(ok.body.idProjeto).toBe(ids.projeto);
    expect(ok.body.idUsuarioCriador).toBe(ids.usuario);
  });
});
