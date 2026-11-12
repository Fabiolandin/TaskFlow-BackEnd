/**
 * SPEC-006: tarefas, as duas pontas (lado da API).
 *
 * CA cobertos: CA-01 a CA-11 (entrego) e CA-N1 a CA-N5 (não-regrido).
 * CA-12 a CA-17 são de tela: `docs/revisoes/evidencias/spec-006-verificar.mjs`.
 * CA-N6 (Projetos, Status, Labels e Usuários) é coberto pela suíte inteira (SPEC-005, 003a...).
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
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec006-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

describe('SPEC-006: tarefas, as duas pontas', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let ana: number; // criadora (token), membro do projeto 1
  let bia: number; // membro do projeto 1
  let caio: number; // não é membro de nada
  let p1: number;
  let p2: number;
  let l1: number;
  let l2: number;
  let l3: number;
  let tarefaIds: number[]; // 12 tarefas: 1..7 no P1, 8..12 no P2

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: bancoDescartavel() }) });
    const usuario = (nome: string) =>
      prisma.usuarios.create({
        data: { nome, email: `${nome.toLowerCase()}@teste.com`, senha: 'hash-secreto' },
      });
    ana = (await usuario('Ana')).id;
    bia = (await usuario('Bia')).id;
    caio = (await usuario('Caio')).id;
    p1 = (await prisma.projetos.create({ data: { nome: 'P1', idStatus: 1 } })).id;
    p2 = (await prisma.projetos.create({ data: { nome: 'P2', idStatus: 1 } })).id;
    await prisma.usuariosProjetos.create({ data: { idUsuario: ana, idProjeto: p1 } });
    await prisma.usuariosProjetos.create({ data: { idUsuario: bia, idProjeto: p1 } });
    l1 = (await prisma.labels.create({ data: { nome: 'Bug' } })).id;
    l2 = (await prisma.labels.create({ data: { nome: 'Front' } })).id;
    l3 = (await prisma.labels.create({ data: { nome: 'Back' } })).id;

    tarefaIds = [];
    for (let i = 1; i <= 12; i++) {
      const t = await prisma.tarefas.create({
        data: {
          nome: `Tarefa ${i}`,
          idStatus: i % 2 === 0 ? 2 : 1,
          prioridade: 'Alta',
          idUsuarioCriador: i <= 3 ? bia : ana,
          idUsuarioResponsavel: i === 1 || i === 2 ? bia : null,
          idProjeto: i <= 7 ? p1 : p2,
        },
      });
      tarefaIds.push(t.id);
    }
    await prisma.labelsTarefas.create({ data: { idTarefa: tarefaIds[0], idLabel: l1 } });
    await prisma.labelsTarefas.create({ data: { idTarefa: tarefaIds[1], idLabel: l1 } });
    await prisma.labelsTarefas.create({ data: { idTarefa: tarefaIds[1], idLabel: l2 } });

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

  const novaTarefa = (extra: object = {}) => ({
    nome: 'Nova',
    idStatus: 1,
    prioridade: 'Baixa',
    idProjeto: p1,
    ...extra,
  });

  const vinculosDe = async (idTarefa: number) =>
    (await prisma.labelsTarefas.findMany({ where: { idTarefa }, orderBy: { idLabel: 'asc' } })).map(
      (v) => v.idLabel,
    );

  function temChave(valor: unknown, chave: string): boolean {
    if (Array.isArray(valor)) return valor.some((v) => temChave(v, chave));
    if (valor && typeof valor === 'object') {
      return Object.entries(valor).some(([k, v]) => k === chave || temChave(v, chave));
    }
    return false;
  }

  // ---------- Entrego ----------

  it('CA-01: GET /tarefas sem parâmetros devolve o envelope, página 1, até 10 itens, por id', async () => {
    const res = await http().get('/tarefas');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'page', 'total', 'totalPages']);
    expect(res.body.page).toBe(1);
    expect(res.body.total).toBe(12);
    expect(res.body.totalPages).toBe(2);
    expect(res.body.data).toHaveLength(10);
    const ids = res.body.data.map((t: { id: number }) => t.id);
    expect(ids).toEqual([...ids].sort((a: number, b: number) => a - b));
    expect(ids).toEqual(tarefaIds.slice(0, 10));
  });

  it('CA-02: cada filtro restringe data e total; dois filtros combinam com E', async () => {
    const por = async (q: string) => (await http().get(`/tarefas?${q}`)).body;

    const projeto = await por(`idProjeto=${p2}`);
    expect(projeto.total).toBe(5);
    expect(projeto.data.every((t: { idProjeto: number }) => t.idProjeto === p2)).toBe(true);

    const status = await por('idStatus=2');
    expect(status.total).toBe(6);
    expect(status.data.every((t: { idStatus: number }) => t.idStatus === 2)).toBe(true);

    const resp = await por(`idUsuarioResponsavel=${bia}`);
    expect(resp.total).toBe(2);
    expect(resp.data.map((t: { id: number }) => t.id)).toEqual([tarefaIds[0], tarefaIds[1]]);

    const criador = await por(`idUsuarioCriador=${bia}`);
    expect(criador.total).toBe(3);

    const label = await por(`idLabel=${l1}`);
    expect(label.total).toBe(2);
    const labelUma = await por(`idLabel=${l2}`);
    expect(labelUma.total).toBe(1);

    // E: projeto 1 e status 2 (tarefas 2, 4, 6) ; projeto 1 e label l1 (tarefas 1, 2)
    const combinado = await por(`idProjeto=${p1}&idStatus=2`);
    expect(combinado.total).toBe(3);
    const combinado2 = await por(`idProjeto=${p2}&idLabel=${l1}`);
    expect(combinado2.total).toBe(0);
    expect(combinado2.data).toEqual([]);
  });

  it('CA-03: parâmetro inválido responde 400, nunca 500', async () => {
    for (const q of [
      'page=0',
      'page=abc',
      'limit=0',
      'limit=101',
      'limit=abc',
      'idProjeto=abc',
      'idStatus=1.5',
      'idLabel=x',
      'idUsuarioResponsavel=abc',
      'idUsuarioCriador=abc',
    ]) {
      const res = await http().get(`/tarefas?${q}`);
      expect({ q, status: res.status }).toEqual({ q, status: 400 });
    }
    // página absurdamente grande: não pode virar 500 (skip estoura o inteiro do banco)
    const enorme = await http().get('/tarefas?page=99999999999999');
    expect(enorme.status).toBeLessThan(500);
    const limite = await http().get('/tarefas?limit=100');
    expect(limite.status).toBe(200);
  });

  it('CA-04: totalPages é o teto de total/limit; página além da última devolve data vazio', async () => {
    const res = await http().get('/tarefas?limit=5');
    expect(res.body.totalPages).toBe(3);
    expect(res.body.data).toHaveLength(5);

    const ultima = await http().get('/tarefas?limit=5&page=3');
    expect(ultima.body.data).toHaveLength(2);

    const alem = await http().get('/tarefas?limit=5&page=9');
    expect(alem.status).toBe(200);
    expect(alem.body.data).toEqual([]);
    expect(alem.body.total).toBe(12);
    expect(alem.body.page).toBe(9);
    expect(alem.body.totalPages).toBe(3);

    const vazio = await http().get(`/tarefas?idLabel=${l3}`);
    expect(vazio.body.total).toBe(0);
    expect(vazio.body.totalPages).toBe(0);
  });

  function esperaFormato(t: any) {
    expect(Object.keys(t).sort()).toEqual(
      [
        'id',
        'nome',
        'descricao',
        'idStatus',
        'prioridade',
        'data_inicio',
        'data_final',
        'createdAt',
        'updatedAt',
        'idUsuarioResponsavel',
        'idUsuarioCriador',
        'idProjeto',
        'status',
        'projeto',
        'responsavel',
        'criador',
        'labels',
        // SPEC-019 alterou o RF-32: tarefa-pai e contagem de sub-tarefas
        'idTarefaPai',
        'tarefaPai',
        'subtarefas',
      ].sort(),
    );
    expect(Object.keys(t.status).sort()).toEqual(['cor', 'id', 'isFinal', 'nome']);
    expect(Object.keys(t.projeto).sort()).toEqual(['id', 'nome']);
    expect(Object.keys(t.criador).sort()).toEqual(['email', 'id', 'nome']);
    if (t.responsavel !== null) {
      expect(Object.keys(t.responsavel).sort()).toEqual(['email', 'id', 'nome']);
    }
    expect(Array.isArray(t.labels)).toBe(true);
    for (const l of t.labels) expect(Object.keys(l).sort()).toEqual(['id', 'nome']);
  }

  it('CA-05: as 4 rotas devolvem o mesmo formato', async () => {
    const lista = await http().get('/tarefas');
    esperaFormato(lista.body.data[1]);
    expect(lista.body.data[1].labels).toEqual([
      { id: l1, nome: 'Bug' },
      { id: l2, nome: 'Front' },
    ]);
    expect(lista.body.data[1].responsavel).toEqual({ id: bia, nome: 'Bia', email: 'bia@teste.com' });
    expect(lista.body.data[5].responsavel).toBeNull();

    const um = await http().get(`/tarefas/${tarefaIds[1]}`);
    expect(um.status).toBe(200);
    esperaFormato(um.body);

    const criada = await http().post(
      '/tarefas',
      novaTarefa({ descricao: 'texto', idUsuarioResponsavel: bia, labelIds: [l1] }),
    );
    expect(criada.status).toBe(201);
    esperaFormato(criada.body);
    expect(criada.body.descricao).toBe('texto');
    expect(criada.body.projeto).toEqual({ id: p1, nome: 'P1' });
    expect(criada.body.criador.id).toBe(ana);

    const editada = await http().patch(`/tarefas/${tarefaIds[0]}`, { nome: 'Editada' });
    expect(editada.status).toBe(200);
    esperaFormato(editada.body);
    expect(editada.body.nome).toBe('Editada');
  });

  it('CA-06: nenhuma das 4 respostas contém senha, com responsável e criador preenchidos', async () => {
    const respostas = [
      await http().get('/tarefas'),
      await http().get(`/tarefas/${tarefaIds[0]}`),
      await http().post('/tarefas', novaTarefa({ idUsuarioResponsavel: bia })),
      await http().patch(`/tarefas/${tarefaIds[0]}`, { idUsuarioResponsavel: ana }),
    ];
    for (const r of respostas) {
      expect(r.status).toBeLessThan(300);
      expect(temChave(r.body, 'senha')).toBe(false);
      expect(JSON.stringify(r.body)).not.toMatch(/hash-secreto/);
    }
    // o teste só prova algo se responsável e criador (dados de Usuarios) estão na resposta
    for (const r of [respostas[1], respostas[2], respostas[3]]) {
      expect(r.body.responsavel).toEqual(expect.objectContaining({ email: expect.any(String) }));
      expect(r.body.criador).toEqual(expect.objectContaining({ email: expect.any(String) }));
    }
    expect(respostas[0].body.data[0].responsavel.email).toBe('bia@teste.com');
  });

  it('CA-07: o PATCH devolve as labels depois da substituição', async () => {
    const res = await http().patch(`/tarefas/${tarefaIds[1]}`, { labelIds: [l3] });
    expect(res.status).toBe(200);
    expect(res.body.labels).toEqual([{ id: l3, nome: 'Back' }]);
    expect(await vinculosDe(tarefaIds[1])).toEqual([l3]);
  });

  it('CA-08: POST com labelIds grava os dois vínculos e mostra em labels', async () => {
    const res = await http().post('/tarefas', novaTarefa({ labelIds: [l1, l2] }));
    expect(res.status).toBe(201);
    expect(res.body.labels).toEqual([
      { id: l1, nome: 'Bug' },
      { id: l2, nome: 'Front' },
    ]);
    expect(await vinculosDe(res.body.id)).toEqual([l1, l2]);
  });

  it('CA-09: PATCH com labelIds substitui; [] remove todos; ausente não altera', async () => {
    const t = tarefaIds[1]; // tem l1 e l2
    const troca = await http().patch(`/tarefas/${t}`, { labelIds: [l2, l3] });
    expect(troca.status).toBe(200);
    expect(await vinculosDe(t)).toEqual([l2, l3]);

    const ausente = await http().patch(`/tarefas/${t}`, { nome: 'So nome' });
    expect(ausente.status).toBe(200);
    expect(await vinculosDe(t)).toEqual([l2, l3]);
    expect(ausente.body.labels).toHaveLength(2);

    const vazio = await http().patch(`/tarefas/${t}`, { labelIds: [] });
    expect(vazio.status).toBe(200);
    expect(vazio.body.labels).toEqual([]);
    expect(await vinculosDe(t)).toEqual([]);
  });

  it('CA-10: label inexistente responde 400 nomeando os ids, sem gravar nada, em POST e PATCH', async () => {
    const antes = await prisma.tarefas.count();
    const post = await http().post('/tarefas', novaTarefa({ labelIds: [l1, 9998, 9999] }));
    expect(post.status).toBe(400);
    expect(post.body.message).toMatch(/9998/);
    expect(post.body.message).toMatch(/9999/);
    expect(await prisma.tarefas.count()).toBe(antes);

    const t = tarefaIds[1]; // l1 e l2
    const patch = await http().patch(`/tarefas/${t}`, {
      nome: 'NAO DEVE GRAVAR',
      labelIds: [l3, 9998, 9999],
    });
    expect(patch.status).toBe(400);
    expect(patch.body.message).toMatch(/9998/);
    expect(patch.body.message).toMatch(/9999/);
    expect(await vinculosDe(t)).toEqual([l1, l2]);
    expect((await prisma.tarefas.findUnique({ where: { id: t } }))?.nome).toBe('Tarefa 2');

    // mesma mensagem nas duas rotas
    const post2 = await http().post('/tarefas', novaTarefa({ labelIds: [9998, 9999] }));
    expect(post2.body.message).toBe(patch.body.message);
  });

  it('CA-11: labelIds não inteiro ou repetido responde 400', async () => {
    for (const labelIds of [['a'], [1.5], [l1, l1], 'x', [null]]) {
      const post = await http().post('/tarefas', novaTarefa({ labelIds }));
      expect({ labelIds, status: post.status }).toEqual({ labelIds, status: 400 });
      const patch = await http().patch(`/tarefas/${tarefaIds[0]}`, { labelIds });
      expect({ labelIds, status: patch.status }).toEqual({ labelIds, status: 400 });
    }
    expect(await vinculosDe(tarefaIds[0])).toEqual([l1]);
  });

  // ---------- Não-regrido ----------

  it('CA-N1: responsável que não é membro continua recusado com 400, no POST e no PATCH', async () => {
    const post = await http().post('/tarefas', novaTarefa({ idUsuarioResponsavel: caio }));
    expect(post.status).toBe(400);
    expect(post.body.message).toBe('O responsável precisa ser membro do projeto da tarefa');

    const patch = await http().patch(`/tarefas/${tarefaIds[0]}`, { idUsuarioResponsavel: caio });
    expect(patch.status).toBe(400);
    expect(patch.body.message).toBe('O responsável precisa ser membro do projeto da tarefa');
  });

  it('CA-N2: DELETE continua removendo vínculos de label e comentários', async () => {
    const t = tarefaIds[1];
    await prisma.comentariosTarefas.create({
      data: { comentario: 'oi', idTarefa: t, idUsuario: ana },
    });
    const res = await http().delete(`/tarefas/${t}`);
    expect(res.status).toBe(200);
    expect(await prisma.labelsTarefas.count({ where: { idTarefa: t } })).toBe(0);
    expect(await prisma.comentariosTarefas.count({ where: { idTarefa: t } })).toBe(0);
    expect(await prisma.tarefas.findUnique({ where: { id: t } })).toBeNull();
  });

  it('CA-N3: tarefa inexistente continua 404; status continua objeto com nome e cor', async () => {
    const res = await http().get('/tarefas/99999');
    expect(res.status).toBe(404);
    const um = await http().get(`/tarefas/${tarefaIds[0]}`);
    expect(um.body.status).toMatchObject({ nome: 'A Fazer' });
    expect(um.body.status).toHaveProperty('cor');
  });

  it('CA-N4: o criador vem do token e o PATCH não troca o autor', async () => {
    const criada = await http().post('/tarefas', novaTarefa({ idUsuarioCriador: caio }));
    expect(criada.status).toBe(201);
    expect(criada.body.idUsuarioCriador).toBe(ana);

    const patch = await http().patch(`/tarefas/${tarefaIds[0]}`, { idUsuarioCriador: caio });
    expect(patch.status).toBe(200);
    expect(patch.body.idUsuarioCriador).toBe(bia);
  });

  it('CA-N5: as rotas de tarefa sem token continuam 401', async () => {
    const s = request(app.getHttpServer());
    expect((await s.get('/tarefas')).status).toBe(401);
    expect((await s.get(`/tarefas/${tarefaIds[0]}`)).status).toBe(401);
    expect((await s.post('/tarefas').send(novaTarefa())).status).toBe(401);
    expect((await s.patch(`/tarefas/${tarefaIds[0]}`).send({ nome: 'x' })).status).toBe(401);
    expect((await s.delete(`/tarefas/${tarefaIds[0]}`)).status).toBe(401);
  });
});
