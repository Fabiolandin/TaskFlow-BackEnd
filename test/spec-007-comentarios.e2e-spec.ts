/**
 * SPEC-007: comentários no detalhe da tarefa e Minhas Tarefas (lado da API).
 *
 * CA cobertos: CA-01 a CA-07 (entrego) e CA-N1, CA-N2, CA-N4, CA-N5, CA-N6 (não-regrido).
 * CA-08 a CA-12 e CA-N3 são de tela: `docs/revisoes/evidencias/spec-007-verificar.mjs`.
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
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec007-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

describe('SPEC-007: comentários e Minhas Tarefas (API)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let jwt: JwtService;
  let ana: number; // autora dos comentários c1 e c2
  let bia: number; // autora do comentário c3
  let caio: number; // criador das tarefas T1 e T2
  let p1: number;
  let p2: number;
  let t1: number; // com 2 comentários da Ana e 1 da Bia
  let t2: number; // sem comentário
  let c1: number;
  let c2: number;
  let c3: number;

  const tokenDe = (id: number) => jwt.sign({ sub: id, email: `u${id}@teste.com` }, { expiresIn: '1h' });

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: bancoDescartavel() }) });
    //SPEC-022 (CA-R2): só o Caio, que exclui usuário, é admin (RF-82); Ana e Bia comentam como usuárias comuns
    const usuario = (nome: string, isAdmin = false) =>
      prisma.usuarios.create({ data: { nome, email: `${nome.toLowerCase()}@teste.com`, senha: 'hash-secreto', isAdmin } });
    ana = (await usuario('Ana')).id;
    bia = (await usuario('Bia')).id;
    caio = (await usuario('Caio', true)).id;
    p1 = (await prisma.projetos.create({ data: { nome: 'P1', idStatus: 1 } })).id;
    p2 = (await prisma.projetos.create({ data: { nome: 'P2', idStatus: 1 } })).id;
    const tarefa = (nome: string, extra: object) =>
      prisma.tarefas.create({
        data: { nome, idStatus: 1, prioridade: 'Alta', idProjeto: p1, idUsuarioCriador: caio, ...extra },
      });
    t1 = (await tarefa('T1', {})).id;
    t2 = (await tarefa('T2', {})).id;
    // createdAt explícito e fora da ordem de id: a ordem tem de vir de createdAt
    c1 = (
      await prisma.comentariosTarefas.create({
        data: { comentario: 'primeiro', idTarefa: t1, idUsuario: ana, createdAt: new Date('2026-01-01T10:00:00Z') },
      })
    ).id;
    c3 = (
      await prisma.comentariosTarefas.create({
        data: { comentario: 'terceiro', idTarefa: t1, idUsuario: bia, createdAt: new Date('2026-01-03T10:00:00Z') },
      })
    ).id;
    c2 = (
      await prisma.comentariosTarefas.create({
        data: { comentario: 'segundo', idTarefa: t1, idUsuario: ana, createdAt: new Date('2026-01-02T10:00:00Z') },
      })
    ).id;

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

  const como = (id: number) => {
    const s = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tokenDe(id)}`);
    return {
      get: (url: string) => auth(s.get(url)),
      post: (url: string, body: object) => auth(s.post(url).send(body)),
      patch: (url: string, body: object) => auth(s.patch(url).send(body)),
      delete: (url: string) => auth(s.delete(url)),
    };
  };

  const CHAVES = ['autor', 'comentario', 'createdAt', 'id', 'idTarefa', 'idUsuario', 'updatedAt'];
  const semSenha = (corpo: unknown) => expect(JSON.stringify(corpo)).not.toMatch(/senha/i);

  // ---------- CA-01 ----------
  describe('CA-01: formato único nas rotas de comentário', () => {
    const confere = (c: any, idUsuario: number, nome: string) => {
      expect(Object.keys(c).sort()).toEqual(CHAVES);
      expect(c.idUsuario).toBe(idUsuario);
      expect(c.autor).toEqual({ id: idUsuario, nome, email: `${nome.toLowerCase()}@teste.com` });
    };

    it('POST', async () => {
      const res = await como(ana).post('/comentariostarefas', { comentario: 'novo', idTarefa: t2 });
      expect(res.status).toBe(201);
      confere(res.body, ana, 'Ana');
    });
    it('GET lista', async () => {
      const res = await como(ana).get('/comentariostarefas');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      for (const c of res.body) expect(Object.keys(c).sort()).toEqual(CHAVES);
      expect(res.body.find((c: any) => c.id === c3).autor.nome).toBe('Bia');
    });
    it('GET /:id', async () => {
      const res = await como(ana).get(`/comentariostarefas/${c1}`);
      expect(res.status).toBe(200);
      confere(res.body, ana, 'Ana');
    });
    it('GET /tarefas/:id', async () => {
      const res = await como(ana).get(`/comentariostarefas/tarefas/${t1}`);
      expect(res.status).toBe(200);
      for (const c of res.body) expect(Object.keys(c).sort()).toEqual(CHAVES);
      expect(res.body[0].autor.nome).toBe('Ana');
    });
    it('PATCH', async () => {
      const res = await como(ana).patch(`/comentariostarefas/${c1}`, { comentario: 'mudado' });
      expect(res.status).toBe(200);
      confere(res.body, ana, 'Ana');
    });
  });

  // ---------- CA-02 ----------
  describe('CA-02: comentários de uma tarefa, em ordem crescente', () => {
    it('só os da tarefa, por createdAt (não por id)', async () => {
      await prisma.comentariosTarefas.create({ data: { comentario: 'de outra', idTarefa: t2, idUsuario: ana } });
      const res = await como(ana).get(`/comentariostarefas/tarefas/${t1}`);
      expect(res.status).toBe(200);
      expect(res.body.map((c: any) => c.id)).toEqual([c1, c2, c3]);
      expect(res.body.every((c: any) => c.idTarefa === t1)).toBe(true);
    });
    it('empate de createdAt desempata por id', async () => {
      const mesmo = new Date('2026-02-01T00:00:00Z');
      const a = await prisma.comentariosTarefas.create({
        data: { comentario: 'a', idTarefa: t2, idUsuario: ana, createdAt: mesmo },
      });
      const b = await prisma.comentariosTarefas.create({
        data: { comentario: 'b', idTarefa: t2, idUsuario: bia, createdAt: mesmo },
      });
      const res = await como(ana).get(`/comentariostarefas/tarefas/${t2}`);
      expect(res.body.map((c: any) => c.id)).toEqual([a.id, b.id]);
    });
    it('tarefa sem comentário devolve []', async () => {
      const res = await como(ana).get(`/comentariostarefas/tarefas/${t2}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
    it('a lista geral também vem em ordem crescente de createdAt', async () => {
      const res = await como(ana).get('/comentariostarefas');
      expect(res.body.map((c: any) => c.id)).toEqual([c1, c2, c3]);
    });
  });

  // ---------- CA-03 ----------
  describe('CA-03: nenhuma resposta de comentário contém `senha`', () => {
    it('as 5 rotas, com autor presente e a chave ausente em todo o JSON', async () => {
      const respostas = [
        await como(ana).post('/comentariostarefas', { comentario: 'novo', idTarefa: t2 }),
        await como(ana).get('/comentariostarefas'),
        await como(ana).get(`/comentariostarefas/${c1}`),
        await como(ana).get(`/comentariostarefas/tarefas/${t1}`),
        await como(ana).patch(`/comentariostarefas/${c1}`, { comentario: 'x' }),
      ];
      for (const res of respostas) {
        expect(res.status).toBeLessThan(300);
        expect(JSON.stringify(res.body)).toContain('"autor"'); // não passa no vazio
        semSenha(res.body);
      }
    });
  });

  // ---------- CA-04, CA-05 ----------
  describe('CA-04: só o autor edita', () => {
    it('outro usuário recebe 403 e o comentário não muda', async () => {
      const antes = await prisma.comentariosTarefas.findUniqueOrThrow({ where: { id: c1 } });
      const res = await como(bia).patch(`/comentariostarefas/${c1}`, { comentario: 'invasão' });
      expect(res.status).toBe(403);
      const depois = await prisma.comentariosTarefas.findUniqueOrThrow({ where: { id: c1 } });
      expect(depois).toEqual(antes);
    });
    it('o autor recebe 200, texto novo e updatedAt atualizado', async () => {
      const antes = await prisma.comentariosTarefas.findUniqueOrThrow({ where: { id: c1 } });
      await new Promise((r) => setTimeout(r, 20));
      const res = await como(ana).patch(`/comentariostarefas/${c1}`, { comentario: 'editado' });
      expect(res.status).toBe(200);
      expect(res.body.comentario).toBe('editado');
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(antes.updatedAt.getTime());
      expect(res.body.createdAt).toBe(antes.createdAt.toISOString());
    });
    it('comentário inexistente continua 404', async () => {
      const res = await como(ana).patch('/comentariostarefas/99999', { comentario: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('CA-05: o PATCH altera só o texto', () => {
    it('idTarefa e idUsuario no corpo são ignorados', async () => {
      const res = await como(ana).patch(`/comentariostarefas/${c1}`, {
        comentario: 'só texto',
        idTarefa: t2,
        idUsuario: bia,
      });
      expect(res.status).toBe(200);
      const depois = await prisma.comentariosTarefas.findUniqueOrThrow({ where: { id: c1 } });
      expect(depois.comentario).toBe('só texto');
      expect(depois.idTarefa).toBe(t1);
      expect(depois.idUsuario).toBe(ana);
      expect(res.body.idTarefa).toBe(t1);
      expect(res.body.autor.id).toBe(ana);
    });
  });

  // ---------- CA-06 ----------
  describe('CA-06: excluir segue aberto a qualquer autenticado', () => {
    it('quem não é o autor exclui (200)', async () => {
      const res = await como(bia).delete(`/comentariostarefas/${c1}`);
      expect(res.status).toBe(200);
      expect(await prisma.comentariosTarefas.findUnique({ where: { id: c1 } })).toBeNull();
    });
  });

  // ---------- CA-07 ----------
  describe('CA-07: filtro idUsuarioEnvolvido em GET /tarefas', () => {
    let envolvidas: number[]; // tarefas em que a Bia é responsável ou criadora
    let soAnaId: number;

    beforeEach(async () => {
      const mk = (nome: string, extra: object) =>
        prisma.tarefas.create({
          data: { nome, idStatus: 1, prioridade: 'Alta', idProjeto: p1, idUsuarioCriador: caio, ...extra },
        });
      const resp = await mk('Bia responsável', { idUsuarioResponsavel: bia });
      const crio = await mk('Bia criadora', { idUsuarioCriador: bia });
      const ambos = await mk('Bia os dois', { idUsuarioCriador: bia, idUsuarioResponsavel: bia });
      const outroProj = await mk('Bia em P2', { idUsuarioResponsavel: bia, idProjeto: p2, idStatus: 2 });
      // fora do filtro, mas com status 2, em P2: sem o filtro, os testes de E acusam
      const soAna = await mk('Só Ana', { idUsuarioCriador: ana, idUsuarioResponsavel: ana, idProjeto: p2, idStatus: 2 });
      soAnaId = soAna.id;
      envolvidas = [resp.id, crio.id, ambos.id, outroProj.id];
    });

    it('devolve responsável ou criador, sem duplicar quem é os dois', async () => {
      const res = await como(ana).get(`/tarefas?idUsuarioEnvolvido=${bia}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((t: any) => t.id);
      expect([...ids].sort()).toEqual([...envolvidas].sort());
      expect(new Set(ids).size).toBe(ids.length);
      expect(res.body.total).toBe(4);
    });
    it('combina com E com idProjeto e idStatus', async () => {
      const res = await como(ana).get(`/tarefas?idUsuarioEnvolvido=${bia}&idProjeto=${p2}`);
      expect(res.body.data.map((t: any) => t.nome)).toEqual(['Bia em P2']);
      const res2 = await como(ana).get(`/tarefas?idUsuarioEnvolvido=${bia}&idStatus=2`);
      expect(res2.body.data.map((t: any) => t.nome)).toEqual(['Bia em P2']);
      expect(res2.body.total).toBe(1);
    });
    it('combina com E com idLabel', async () => {
      const l = await prisma.labels.create({ data: { nome: 'Bug' } });
      await prisma.labelsTarefas.create({ data: { idTarefa: envolvidas[1], idLabel: l.id } });
      await prisma.labelsTarefas.create({ data: { idTarefa: soAnaId, idLabel: l.id } });
      const res = await como(ana).get(`/tarefas?idUsuarioEnvolvido=${bia}&idLabel=${l.id}`);
      expect(res.body.data.map((t: any) => t.id)).toEqual([envolvidas[1]]);
    });
    it('mantém o envelope e a paginação', async () => {
      const res = await como(ana).get(`/tarefas?idUsuarioEnvolvido=${bia}&limit=3&page=2`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 4, page: 2, totalPages: 2 });
      expect(res.body.data).toHaveLength(1);
    });
    it('combina com idUsuarioCriador por E', async () => {
      const res = await como(ana).get(`/tarefas?idUsuarioEnvolvido=${bia}&idUsuarioCriador=${caio}`);
      expect(res.body.data.map((t: any) => t.nome).sort()).toEqual(['Bia em P2', 'Bia responsável']);
      expect(res.body.total).toBe(2);
    });
    it.each(['abc', '1.5'])('valor não inteiro (%s) responde 400', async (v) => {
      const res = await como(ana).get(`/tarefas?idUsuarioEnvolvido=${v}`);
      expect(res.status).toBe(400);
    });
  });

  // ---------- Não-regrido ----------
  describe('CA-N1: criar comentário', () => {
    it('o autor vem do token, nunca do corpo', async () => {
      const res = await como(ana).post('/comentariostarefas', { comentario: 'x', idTarefa: t2, idUsuario: bia });
      expect(res.status).toBe(201);
      const gravado = await prisma.comentariosTarefas.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(gravado.idUsuario).toBe(ana);
    });
    it('tarefa inexistente é recusada com a mensagem de referência inexistente', async () => {
      const res = await como(ana).post('/comentariostarefas', { comentario: 'x', idTarefa: 99999 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Referência inexistente/);
    });
  });

  describe('CA-N2: excluir tarefa remove os comentários na mesma transação', () => {
    it('DELETE /tarefas/:id apaga os comentários dela', async () => {
      const res = await como(ana).delete(`/tarefas/${t1}`);
      expect(res.status).toBe(200);
      expect(await prisma.comentariosTarefas.count({ where: { idTarefa: t1 } })).toBe(0);
    });
  });

  describe('CA-N4: GET /tarefas sem o filtro novo, e sem senha', () => {
    it('sem idUsuarioEnvolvido lista todas, no envelope; os outros filtros seguem', async () => {
      const res = await como(ana).get('/tarefas');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 2, page: 1, totalPages: 1 });
      const res2 = await como(ana).get(`/tarefas?idUsuarioCriador=${caio}&idProjeto=${p1}`);
      expect(res2.body.total).toBe(2);
      const res3 = await como(ana).get(`/tarefas?idProjeto=${p2}`);
      expect(res3.body.total).toBe(0);
    });
    it('as 4 rotas de tarefa seguem sem senha', async () => {
      const novo = { nome: 'N', idStatus: 1, prioridade: 'Baixa', idProjeto: p1 };
      const respostas = [
        await como(ana).get('/tarefas'),
        await como(ana).get(`/tarefas/${t1}`),
        await como(ana).post('/tarefas', novo),
        await como(ana).patch(`/tarefas/${t1}`, { nome: 'T1b' }),
      ];
      for (const res of respostas) {
        expect(res.status).toBeLessThan(300);
        semSenha(res.body);
      }
    });
  });

  describe('CA-N5: sem token continua 401', () => {
    it.each([
      ['get', '/comentariostarefas'],
      ['get', '/comentariostarefas/1'],
      ['get', '/comentariostarefas/tarefas/1'],
      ['post', '/comentariostarefas'],
      ['patch', '/comentariostarefas/1'],
      ['delete', '/comentariostarefas/1'],
    ])('%s %s', async (metodo, url) => {
      const res = await (request(app.getHttpServer()) as any)[metodo](url);
      expect(res.status).toBe(401);
    });
  });

  describe('CA-N6: usuário que comentou não é excluível', () => {
    it('DELETE /usuarios/:id responde 409 "Registro em uso"', async () => {
      const res = await como(caio).delete(`/usuarios/${ana}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Registro em uso/);
    });
  });
});
