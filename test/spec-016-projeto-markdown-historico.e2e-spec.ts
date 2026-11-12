/**
 * SPEC-016: Projeto, markdown e histórico (lado da API).
 *
 * CA cobertos: CA-01..CA-06 (projeto), CA-22..CA-30 (histórico), CA-35, CA-36 (busca) — entrego;
 * CA-N3, CA-N5, CA-N6, CA-N9 — não-regrido.
 * CA de tela: `docs/revisoes/evidencias/spec-016-verificar.mjs`. CA-31: `docs/migrations/SPEC-016.md`.
 *
 * Sobe o AppModule real (guard JWT e ValidationPipe globais) com o AllExceptionsFilter
 * registrado como no main.ts, sobre um SQLite descartável criado das migrations.
 * O prisma/dev.db não é tocado.
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
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec016-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

const ST = { aFazer: 1, andamento: 2, revisao: 3, concluido: 4 };
const MSG_EM_USO = (n: number) =>
  `Projeto em uso: tem ${n} tarefa(s). Exclua ou mova as tarefas antes de excluir o projeto.`;
const CHAVES_ATIVIDADE = [
  'autor', 'campo', 'createdAt', 'id', 'idAnterior', 'idNovo', 'idTarefa', 'idUsuario', 'nomeUsuario', 'valorAnterior', 'valorNovo',
];

describe('SPEC-016: projeto, histórico e busca (API)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let jwt: JwtService;
  let ana: number;
  let bia: number;
  let caio: number;
  let p1: number; // projeto com Ana, Bia e Caio como membros
  let p2: number; // projeto com Ana e Bia

  const tokenDe = (id: number) => jwt.sign({ sub: id, email: `u${id}@teste.com` }, { expiresIn: '1h' });
  const http = (metodo: 'get' | 'post' | 'patch' | 'delete', url: string, corpo?: object, token: string | null = tokenDe(ana)) => {
    let r = request(app.getHttpServer())[metodo](url);
    if (token) r = r.set('Authorization', `Bearer ${token}`);
    return corpo ? r.send(corpo) : r;
  };
  const get = (url: string, token?: string | null) => http('get', url, undefined, token);
  const patch = (url: string, corpo: object, token?: string | null) => http('patch', url, corpo, token);
  const del = (url: string, token?: string | null) => http('delete', url, undefined, token);
  const post = (url: string, corpo: object, token?: string | null) => http('post', url, corpo, token);

  const tarefa = (extra: Record<string, unknown> = {}) =>
    prisma.tarefas.create({
      data: { nome: 'Tarefa', idStatus: ST.aFazer, prioridade: 'Baixa', idProjeto: p1, idUsuarioCriador: ana, ...extra },
    });
  const atividades = async (idTarefa: number) => {
    const res = await get(`/tarefas/${idTarefa}/atividades`);
    expect(res.status).toBe(200);
    return res.body as any[];
  };
  const contar = async (tabela: string, where = '1=1') =>
    Number(((await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "${tabela}" WHERE ${where}`)) as any[])[0].n);
  const semSenha = (corpo: unknown) => expect(JSON.stringify(corpo)).not.toMatch(/senha|hash-secreto/);

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: bancoDescartavel() }) });
    const usuario = async (nome: string) =>
      (await prisma.usuarios.create({ data: { nome, email: `${nome.toLowerCase()}@teste.com`, senha: 'hash-secreto' } })).id;
    ana = await usuario('Ana');
    bia = await usuario('Bia');
    caio = await usuario('Caio');
    p1 = (await prisma.projetos.create({ data: { nome: 'P1', idStatus: 1 } })).id;
    p2 = (await prisma.projetos.create({ data: { nome: 'P2', idStatus: 1 } })).id;
    for (const u of [ana, bia, caio]) await prisma.usuariosProjetos.create({ data: { idUsuario: u, idProjeto: p1 } });
    for (const u of [ana, bia]) await prisma.usuariosProjetos.create({ data: { idUsuario: u, idProjeto: p2 } });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    jwt = new JwtService({ secret: process.env.JWT_SECRET });
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // =================== Parte (a): projeto ===================

  describe('CA-01: progresso por isFinal', () => {
    it('conta total e concluídas por isFinal, por projeto, na mesma página', async () => {
      await tarefa({ idStatus: ST.aFazer });
      await tarefa({ idStatus: ST.andamento });
      await tarefa({ idStatus: ST.concluido });
      await tarefa({ idProjeto: p2, idStatus: ST.concluido });
      await tarefa({ idProjeto: p2, idStatus: ST.concluido });
      const vazio = (await prisma.projetos.create({ data: { nome: 'Vazio', idStatus: 1 } })).id;

      const lista = async () => {
        const res = await get('/projetos?limit=100');
        expect(res.status).toBe(200);
        return Object.fromEntries(res.body.data.map((p: any) => [p.id, p.progresso]));
      };
      let prog = await lista();
      expect(prog[p1]).toEqual({ total: 3, concluidas: 1 });
      expect(prog[p2]).toEqual({ total: 2, concluidas: 2 });
      expect(prog[vazio]).toEqual({ total: 0, concluidas: 0 });

      // renomear o status final não muda a contagem
      await prisma.statusTarefa.update({ where: { id: ST.concluido }, data: { nome: 'Fechado' } });
      // um status NÃO final chamado "Concluído" não conta
      const falso = await prisma.statusTarefa.create({ data: { nome: 'Concluído', ordem: 9, isFinal: false } });
      await tarefa({ idStatus: falso.id });
      prog = await lista();
      expect(prog[p1]).toEqual({ total: 4, concluidas: 1 });
      expect(prog[p2]).toEqual({ total: 2, concluidas: 2 });
    });
  });

  describe('CA-02: formato único nas 4 rotas', () => {
    it('GET, GET :id, POST e PATCH devolvem as mesmas chaves, sem senha', async () => {
      await tarefa({ idStatus: ST.concluido });
      const item = (await get('/projetos?limit=100')).body.data.find((p: any) => p.id === p1);
      const um = await get(`/projetos/${p1}`);
      const criado = await post('/projetos', { nome: 'Novo', idStatus: 2, membros: [bia] });
      const editado = await patch(`/projetos/${p1}`, { nome: 'P1 renomeado' });
      expect([um.status, criado.status, editado.status]).toEqual([200, 201, 200]);

      const chaves = Object.keys(item).sort();
      expect(chaves).toEqual(expect.arrayContaining(['status', 'membros', 'progresso']));
      for (const corpo of [um.body, criado.body, editado.body]) expect(Object.keys(corpo).sort()).toEqual(chaves);
      for (const corpo of [item, um.body, criado.body, editado.body]) {
        semSenha(corpo);
        expect(typeof corpo.status).toBe('object');
        for (const m of corpo.membros) expect(Object.keys(m).sort()).toEqual(['email', 'id', 'nome']);
      }
      expect(criado.body.progresso).toEqual({ total: 0, concluidas: 0 });
      expect(criado.body.membros.map((m: any) => m.id)).toEqual([bia]);
      expect(editado.body.nome).toBe('P1 renomeado');
      expect(editado.body.status.nome).toBe('Mapeando');
      expect(editado.body.membros.map((m: any) => m.id)).toEqual([ana, bia, caio]);
      expect(editado.body.progresso).toEqual({ total: 1, concluidas: 1 });
      expect(um.body.progresso).toEqual({ total: 1, concluidas: 1 });
    });
  });

  describe('CA-03 / CA-04 / CA-05: excluir projeto', () => {
    it('CA-03: sem tarefas e com 2 membros → 200, projeto e vínculos somem, usuários ficam', async () => {
      const res = await del(`/projetos/${p2}`);
      expect(res.status).toBe(200);
      expect(await prisma.projetos.findUnique({ where: { id: p2 } })).toBeNull();
      expect(await prisma.usuariosProjetos.count({ where: { idProjeto: p2 } })).toBe(0);
      expect(await prisma.usuarios.count({ where: { id: { in: [ana, bia] } } })).toBe(2);
      expect(await prisma.usuariosProjetos.count({ where: { idProjeto: p1 } })).toBe(3);
    });

    it('CA-04: com 2 tarefas e 1 membro → 409 com a mensagem exata, nada apagado', async () => {
      const p = (await prisma.projetos.create({ data: { nome: 'Com tarefas', idStatus: 1 } })).id;
      await prisma.usuariosProjetos.create({ data: { idUsuario: ana, idProjeto: p } });
      await tarefa({ idProjeto: p });
      await tarefa({ idProjeto: p });
      const res = await del(`/projetos/${p}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(MSG_EM_USO(2));
      expect(await prisma.projetos.findUnique({ where: { id: p } })).not.toBeNull();
      expect(await prisma.usuariosProjetos.count({ where: { idProjeto: p } })).toBe(1);
      expect(await prisma.tarefas.count({ where: { idProjeto: p } })).toBe(2);
    });

    it('CA-05: id inexistente → 404', async () => {
      const res = await del('/projetos/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('CA-06: paginação de GET /projetos validada', () => {
    it('padrão page=1 limit=9; limit=100 aceito; inválidos → 400', async () => {
      for (let i = 0; i < 10; i++) await prisma.projetos.create({ data: { nome: `Extra ${i}`, idStatus: 1 } });
      const padrao = await get('/projetos');
      expect(padrao.status).toBe(200);
      expect(padrao.body.page).toBe(1);
      expect(padrao.body.data).toHaveLength(9);
      expect(padrao.body.total).toBe(12);
      expect(padrao.body.totalPages).toBe(2);
      const cem = await get('/projetos?limit=100');
      expect(cem.status).toBe(200);
      expect(cem.body.data).toHaveLength(12);
      for (const q of ['page=0', 'page=abc', 'limit=0', 'limit=101', 'limit=1.5']) {
        const res = await get(`/projetos?${q}`);
        expect([q, res.status]).toEqual([q, 400]);
      }
    });
  });

  // =================== Parte (c): histórico ===================

  describe('CA-22: status, prioridade, responsável e projeto', () => {
    it('status + prioridade num PATCH gravam 2 atividades com nomes, ids e autor do token', async () => {
      const t = await tarefa();
      const res = await patch(`/tarefas/${t.id}`, { idStatus: ST.andamento, prioridade: 'Alta' });
      expect(res.status).toBe(200);
      const lista = await atividades(t.id);
      expect(lista).toHaveLength(2);
      const st = lista.find((a) => a.campo === 'status');
      const pr = lista.find((a) => a.campo === 'prioridade');
      expect(st).toMatchObject({ valorAnterior: 'A Fazer', valorNovo: 'Em Andamento', idAnterior: ST.aFazer, idNovo: ST.andamento, idUsuario: ana, nomeUsuario: 'Ana' });
      expect(pr).toMatchObject({ valorAnterior: 'Baixa', valorNovo: 'Alta', idAnterior: null, idNovo: null, idUsuario: ana, nomeUsuario: 'Ana' });
    });

    it('responsável: de nenhum para alguém, de alguém para nenhum', async () => {
      const t = await tarefa();
      await patch(`/tarefas/${t.id}`, { idUsuarioResponsavel: bia });
      await patch(`/tarefas/${t.id}`, { idUsuarioResponsavel: caio });
      await patch(`/tarefas/${t.id}`, { idUsuarioResponsavel: null });
      const lista = (await atividades(t.id)).filter((a) => a.campo === 'responsavel');
      expect(lista.map((a) => [a.valorAnterior, a.idAnterior, a.valorNovo, a.idNovo])).toEqual([
        [null, null, 'Bia', bia],
        ['Bia', bia, 'Caio', caio],
        ['Caio', caio, null, null],
      ]);
    });

    it('trocar o projeto com idUsuarioResponsavel: null grava projeto e responsável', async () => {
      const t = await tarefa({ idUsuarioResponsavel: caio });
      const res = await patch(`/tarefas/${t.id}`, { idProjeto: p2, idUsuarioResponsavel: null });
      expect(res.status).toBe(200);
      const lista = await atividades(t.id);
      expect(lista.map((a) => a.campo).sort()).toEqual(['projeto', 'responsavel']);
      expect(lista.find((a) => a.campo === 'projeto')).toMatchObject({ valorAnterior: 'P1', idAnterior: p1, valorNovo: 'P2', idNovo: p2 });
      expect(lista.find((a) => a.campo === 'responsavel')).toMatchObject({ valorAnterior: 'Caio', idAnterior: caio, valorNovo: null, idNovo: null });
    });
  });

  describe('CA-23: datas, nome e descrição', () => {
    it('datas pelo dia AAAA-MM-DD; nome e descrição com os quatro valores nulos', async () => {
      const t = await tarefa({ data_final: new Date('2026-11-20T00:00:00.000Z') });
      await patch(`/tarefas/${t.id}`, { data_inicio: '2026-11-01' });
      await patch(`/tarefas/${t.id}`, { data_inicio: '2026-11-02', data_final: null });
      await patch(`/tarefas/${t.id}`, { nome: 'Outro nome', descricao: 'Texto **novo**' });
      const lista = await atividades(t.id);
      const so = (campo: string) => lista.filter((a) => a.campo === campo).map((a) => [a.valorAnterior, a.valorNovo, a.idAnterior, a.idNovo]);
      expect(so('data_inicio')).toEqual([[null, '2026-11-01', null, null], ['2026-11-01', '2026-11-02', null, null]]);
      expect(so('data_final')).toEqual([['2026-11-20', null, null, null]]);
      expect(so('nome')).toEqual([[null, null, null, null]]);
      expect(so('descricao')).toEqual([[null, null, null, null]]);
    });
  });

  describe('CA-24: uma atividade por label', () => {
    it('[A, B] → [B, C] grava "adicionou C" e "removeu A", nada para B', async () => {
      const [A, B, C] = await Promise.all(['A', 'B', 'C'].map((nome) => prisma.labels.create({ data: { nome } })));
      const t = await tarefa();
      await prisma.labelsTarefas.createMany({ data: [A, B].map((l) => ({ idLabel: l.id, idTarefa: t.id })) });
      const res = await patch(`/tarefas/${t.id}`, { labelIds: [B.id, C.id] });
      expect(res.status).toBe(200);
      const lista = (await atividades(t.id)).filter((a) => a.campo === 'label');
      expect(lista).toHaveLength(2);
      expect(lista).toEqual(expect.arrayContaining([
        expect.objectContaining({ valorAnterior: null, idAnterior: null, valorNovo: 'C', idNovo: C.id }),
        expect.objectContaining({ valorAnterior: 'A', idAnterior: A.id, valorNovo: null, idNovo: null }),
      ]));
    });
  });

  describe('CA-25: sem mudança ou recusado não grava', () => {
    it('mesmos valores, mesma lista de labels em outra ordem e PATCH recusado → nenhuma atividade', async () => {
      const [A, B] = await Promise.all(['A', 'B'].map((nome) => prisma.labels.create({ data: { nome } })));
      const t = await tarefa({ idUsuarioResponsavel: bia, data_inicio: new Date('2026-11-01T00:00:00.000Z'), descricao: 'x' });
      await prisma.labelsTarefas.createMany({ data: [A, B].map((l) => ({ idLabel: l.id, idTarefa: t.id })) });
      const mesmo = await patch(`/tarefas/${t.id}`, {
        nome: 'Tarefa', idStatus: ST.aFazer, prioridade: 'Baixa', idUsuarioResponsavel: bia, idProjeto: p1,
        data_inicio: '2026-11-01', descricao: 'x', labelIds: [B.id, A.id],
      });
      expect(mesmo.status).toBe(200);
      const antes = await get(`/tarefas/${t.id}`);

      const recusados = [
        await patch(`/tarefas/${t.id}`, { prioridade: 'Alta', labelIds: [A.id, 99999] }),
        await patch(`/tarefas/${t.id}`, { prioridade: 'Alta', idProjeto: p2, idUsuarioResponsavel: caio }),
        await patch(`/tarefas/${t.id}`, { prioridade: 'Alta', idStatus: 99999 }),
      ];
      expect(recusados.map((r) => r.status)).toEqual([400, 400, 400]);
      expect(await atividades(t.id)).toEqual([]);
      const depois = await get(`/tarefas/${t.id}`);
      expect(depois.body).toEqual(antes.body);
    });
  });

  describe('CA-26: token de usuário excluído', () => {
    it('PATCH que muda campo → 400, tarefa intacta, nenhuma atividade', async () => {
      const t = await tarefa();
      const fantasma = (await prisma.usuarios.create({ data: { nome: 'Fantasma', email: 'f@teste.com', senha: 'hash-secreto' } })).id;
      const token = tokenDe(fantasma);
      await prisma.usuarios.delete({ where: { id: fantasma } });
      const res = await patch(`/tarefas/${t.id}`, { prioridade: 'Urgente' }, token);
      expect(res.status).toBe(400);
      expect((await prisma.tarefas.findUnique({ where: { id: t.id } }))?.prioridade).toBe('Baixa');
      expect(await atividades(t.id)).toEqual([]);
    });
  });

  describe('CA-27: GET /tarefas/:id/atividades', () => {
    it('ordem, formato exato, autor sem senha, [] / 404 / 400 / 401, e aberta a outro usuário', async () => {
      const t = await tarefa();
      await patch(`/tarefas/${t.id}`, { prioridade: 'Média' });
      await patch(`/tarefas/${t.id}`, { idStatus: ST.revisao }, tokenDe(bia));
      await patch(`/tarefas/${t.id}`, { prioridade: 'Alta' });
      const res = await get(`/tarefas/${t.id}/atividades`);
      expect(res.status).toBe(200);
      semSenha(res.body);
      expect(res.body).toHaveLength(3);
      for (const a of res.body) {
        expect(Object.keys(a).sort()).toEqual(CHAVES_ATIVIDADE);
        expect(Object.keys(a.autor).sort()).toEqual(['email', 'id', 'nome']);
        expect(a.idTarefa).toBe(t.id);
      }
      const ordenado = [...res.body].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id - y.id);
      expect(res.body.map((a: any) => a.id)).toEqual(ordenado.map((a: any) => a.id));
      expect(res.body.map((a: any) => a.valorNovo)).toEqual(['Média', 'Em Revisão', 'Alta']);
      expect(res.body[1].autor).toEqual({ id: bia, nome: 'Bia', email: 'bia@teste.com' });

      const outro = await get(`/tarefas/${t.id}/atividades`, tokenDe(caio));
      expect(outro.status).toBe(200);
      expect(outro.body).toEqual(res.body);

      const vazia = await tarefa();
      expect((await get(`/tarefas/${vazia.id}/atividades`)).body).toEqual([]);
      expect((await get('/tarefas/99999/atividades')).status).toBe(404);
      expect((await get('/tarefas/abc/atividades')).status).toBe(400);
      expect((await get(`/tarefas/${t.id}/atividades`, null)).status).toBe(401);
    });
  });

  describe('CA-28: atividade imutável', () => {
    it('sem rota de escrita; renomear status e label não muda o histórico; label citada é excluível', async () => {
      const L = await prisma.labels.create({ data: { nome: 'Bug' } });
      const t = await tarefa();
      await patch(`/tarefas/${t.id}`, { idStatus: ST.andamento, labelIds: [L.id] });
      const [primeira] = await atividades(t.id);
      for (const [metodo, url] of [
        ['post', `/tarefas/${t.id}/atividades`], ['patch', `/tarefas/${t.id}/atividades`], ['delete', `/tarefas/${t.id}/atividades`],
        ['post', `/tarefas/${t.id}/atividades/${primeira.id}`], ['patch', `/tarefas/${t.id}/atividades/${primeira.id}`], ['delete', `/tarefas/${t.id}/atividades/${primeira.id}`],
      ] as const) {
        const res = await http(metodo, url, metodo === 'delete' ? undefined : { campo: 'x' });
        expect([metodo, url, res.status]).toEqual([metodo, url, 404]);
      }
      await prisma.statusTarefa.update({ where: { id: ST.andamento }, data: { nome: 'Fazendo' } });
      await prisma.labels.update({ where: { id: L.id }, data: { nome: 'Defeito' } });
      let lista = await atividades(t.id);
      expect(lista.find((a) => a.campo === 'status').valorNovo).toBe('Em Andamento');
      expect(lista.find((a) => a.campo === 'label').valorNovo).toBe('Bug');

      await patch(`/tarefas/${t.id}`, { labelIds: [] });
      const exclui = await del(`/labels/${L.id}`);
      expect(exclui.status).toBe(200);
      lista = await atividades(t.id);
      const labels = lista.filter((a) => a.campo === 'label');
      expect(labels.map((a) => [a.valorAnterior, a.idAnterior, a.valorNovo, a.idNovo])).toEqual([
        [null, null, 'Bug', L.id],
        ['Defeito', L.id, null, null],
      ]);
    });
  });

  describe('CA-29: excluir tarefa apaga tudo dela', () => {
    it('labels, comentários e atividades somem com a tarefa', async () => {
      const L = await prisma.labels.create({ data: { nome: 'L' } });
      const t = await tarefa();
      await patch(`/tarefas/${t.id}`, { labelIds: [L.id], prioridade: 'Alta' });
      await prisma.comentariosTarefas.create({ data: { comentario: 'oi', idTarefa: t.id, idUsuario: bia } });
      expect(await contar('AtividadesTarefa', `"idTarefa" = ${t.id}`)).toBe(2);
      const res = await del(`/tarefas/${t.id}`);
      expect(res.status).toBe(200);
      expect(await prisma.tarefas.findUnique({ where: { id: t.id } })).toBeNull();
      expect(await prisma.labelsTarefas.count({ where: { idTarefa: t.id } })).toBe(0);
      expect(await prisma.comentariosTarefas.count({ where: { idTarefa: t.id } })).toBe(0);
      expect(await contar('AtividadesTarefa', `"idTarefa" = ${t.id}`)).toBe(0);
    });
  });

  describe('CA-30: autor de atividade continua excluível', () => {
    it('usuário que só alterou tarefas é excluído; atividades ficam com idUsuario null e o nome', async () => {
      const dani = (await prisma.usuarios.create({ data: { nome: 'Dani', email: 'dani@teste.com', senha: 'hash-secreto' } })).id;
      const t = await tarefa();
      await patch(`/tarefas/${t.id}`, { prioridade: 'Urgente' }, tokenDe(dani));
      await prisma.usuarios.update({ where: { id: dani }, data: { nome: 'Dani Renomeada' } });
      const res = await del(`/usuarios/${dani}`);
      expect(res.status).toBe(200);
      const [a] = await atividades(t.id);
      expect(a).toMatchObject({ idUsuario: null, autor: null, nomeUsuario: 'Dani' });
    });
  });

  // =================== Parte (d): busca ===================

  describe('CA-35: busca em GET /tarefas', () => {
    it('nome contém, trim, curingas literais, limite de 100 e acento sem normalizar', async () => {
      const nomes = ['Login', 'Blog novo', 'Ação', '100% pronto', 'a_b', 'Outra'];
      const ids: Record<string, number> = {};
      for (const nome of nomes) ids[nome] = (await tarefa({ nome })).id;
      const logP2 = (await tarefa({ nome: 'catalogo', idProjeto: p2 })).id;
      const nomesDe = async (q: string) => {
        const res = await get(`/tarefas?limit=100&${q}`);
        expect([q, res.status]).toEqual([q, 200]);
        return res.body.data.map((t: any) => t.nome).sort();
      };
      expect(await nomesDe('busca=log')).toEqual(['Blog novo', 'Login', 'catalogo']);
      expect(await nomesDe(`busca=log&idProjeto=${p1}`)).toEqual(['Blog novo', 'Login']);
      const pag = await get('/tarefas?busca=log&limit=2&page=2');
      expect(pag.body.total).toBe(3);
      expect(pag.body.data).toHaveLength(1);
      expect(pag.body.data[0].id).toBe(logP2);
      expect(await nomesDe('busca=%20log%20')).toEqual(await nomesDe('busca=log'));
      const todas = await nomesDe('');
      expect(await nomesDe('busca=')).toEqual(todas);
      expect(await nomesDe('busca=%20%20')).toEqual(todas);
      expect(await nomesDe('busca=%25')).toEqual(['100% pronto']);
      expect(await nomesDe('busca=_')).toEqual(['a_b']);
      expect((await get(`/tarefas?busca=${'a'.repeat(101)}`)).status).toBe(400);
      expect((await get(`/tarefas?busca=${'a'.repeat(100)}`)).status).toBe(200);
      expect(await nomesDe('busca=acao')).toEqual([]);
    });
  });

  describe('CA-36: busca em GET /projetos', () => {
    it('mesmas regras sobre o nome do projeto, com paginação e o formato do RF-51', async () => {
      for (const nome of ['Login web', 'Blog', 'Ação', '50% feito', 'x_y']) await prisma.projetos.create({ data: { nome, idStatus: 1 } });
      const nomesDe = async (q: string) => {
        const res = await get(`/projetos?limit=100&${q}`);
        expect([q, res.status]).toEqual([q, 200]);
        return res.body.data.map((p: any) => p.nome).sort();
      };
      expect(await nomesDe('busca=log')).toEqual(['Blog', 'Login web']);
      expect(await nomesDe('busca=%20log%20')).toEqual(['Blog', 'Login web']);
      const todos = await nomesDe('');
      expect(await nomesDe('busca=')).toEqual(todos);
      expect(await nomesDe('busca=%20%20')).toEqual(todos);
      expect(await nomesDe('busca=%25')).toEqual(['50% feito']);
      expect(await nomesDe('busca=_')).toEqual(['x_y']);
      expect(await nomesDe('busca=acao')).toEqual([]);
      expect((await get(`/projetos?busca=${'a'.repeat(101)}`)).status).toBe(400);
      const pag = await get('/projetos?busca=log&limit=1&page=2');
      expect(pag.body.total).toBe(2);
      expect(pag.body.totalPages).toBe(2);
      expect(pag.body.data).toHaveLength(1);
      expect(Object.keys(pag.body.data[0])).toEqual(expect.arrayContaining(['status', 'membros', 'progresso']));
    });
  });

  // =================== não-regrido ===================

  describe('CA-N3: formato de tarefa sem campo novo', () => {
    it('GET, GET :id, POST e PATCH /tarefas com as mesmas chaves de antes, sem atividades', async () => {
      const t = await tarefa();
      const esperado = [
        'createdAt', 'criador', 'data_final', 'data_inicio', 'descricao', 'id', 'idProjeto', 'idStatus', 'idUsuarioCriador',
        'idUsuarioResponsavel', 'labels', 'nome', 'prioridade', 'projeto', 'responsavel', 'status', 'updatedAt',
        // SPEC-019 alterou o RF-32: tarefa-pai e contagem de sub-tarefas
        'idTarefaPai', 'subtarefas', 'tarefaPai',
      ].sort();
      const lista = await get('/tarefas');
      const um = await get(`/tarefas/${t.id}`);
      const criada = await post('/tarefas', { nome: 'N', idStatus: 1, prioridade: 'Alta', idProjeto: p1 });
      const editada = await patch(`/tarefas/${t.id}`, { prioridade: 'Alta' });
      for (const corpo of [lista.body.data[0], um.body, criada.body, editada.body]) expect(Object.keys(corpo).sort()).toEqual(esperado);
      expect((await patch(`/tarefas/${t.id}`, { idUsuarioResponsavel: 99999 })).status).toBe(400);
    });
  });

  describe('CA-N5: exclusões em uso seguem recusadas', () => {
    it('label, status e usuário em uso → 409 "Registro em uso"; membro → mensagem do RF-30', async () => {
      const L = await prisma.labels.create({ data: { nome: 'L' } });
      const t = await tarefa();
      await prisma.labelsTarefas.create({ data: { idLabel: L.id, idTarefa: t.id } });
      for (const url of [`/labels/${L.id}`, `/statustarefa/${ST.aFazer}`]) {
        const res = await del(url);
        expect([url, res.status]).toEqual([url, 409]);
        expect(res.body.message).toMatch(/^Registro em uso: /);
      }
      const membro = await del(`/usuarios/${caio}`);
      expect(membro.status).toBe(409);
      expect(membro.body.message).toMatch(/membro de 1 projeto\(s\)/);
      // criador que saiu dos projetos continua preso pela tarefa que criou
      await prisma.usuariosProjetos.deleteMany({ where: { idUsuario: ana } });
      const criador = await del(`/usuarios/${ana}`, tokenDe(bia));
      expect(criador.status).toBe(409);
      expect(criador.body.message).toMatch(/^Registro em uso: /);
    });
  });

  describe('CA-N6: POST /projetos com membros continua atômico', () => {
    it('id de usuário inexistente → 400 nomeando os ids, nada gravado', async () => {
      const antes = await prisma.projetos.count();
      const res = await post('/projetos', { nome: 'X', idStatus: 1, membros: [ana, 777, 888] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/777, 888/);
      expect(await prisma.projetos.count()).toBe(antes);
    });
  });

  describe('CA-N9: progresso bate com o Dashboard', () => {
    it('soma de progresso = tarefas do Dashboard', async () => {
      await tarefa({ idStatus: ST.concluido });
      await tarefa({ idStatus: ST.andamento });
      await tarefa({ idProjeto: p2, idStatus: ST.concluido });
      const dash = (await get('/dashboard')).body.tarefas;
      const projetos = (await get('/projetos?limit=100')).body.data;
      const soma = (k: 'total' | 'concluidas') => projetos.reduce((s: number, p: any) => s + p.progresso[k], 0);
      expect(soma('total')).toBe(dash.total);
      expect(soma('concluidas')).toBe(dash.concluidas);
      expect(dash.total).toBe(3);
      expect(dash.concluidas).toBe(2);
    });
  });
});
