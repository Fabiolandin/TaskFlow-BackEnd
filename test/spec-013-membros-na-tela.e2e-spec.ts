/**
 * SPEC-013: excluir usuário que é membro de projeto é recusado com mensagem que diz por quê.
 *
 * CA cobertos: CA-07 (entrego, lado API) e CA-08, CA-09, CA-12 (não-regrido).
 * CA-01 a CA-06, CA-10, CA-11 e o lado de tela do CA-07 são de tela:
 * `docs/revisoes/evidencias/spec-013-verificar.mjs`.
 *
 * Isolamento da causa (CA-07): o usuário "membro" do teste NÃO cria tarefa, não é
 * responsável nem comenta — o único vínculo dele é `UsuariosProjetos`. Assim o 409 só pode
 * vir da checagem de membro, e não do P2003 de outra FK.
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
const EM_USO = 'Registro em uso: não pode ser excluído porque outros registros dependem dele';

function bancoDescartavel(): string {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-spec013-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

describe('SPEC-013: excluir usuário membro explica o motivo', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let ana: number; // autora do token; cria as tarefas do teste
  let p1: number;
  let p2: number;

  const criarUsuario = (nome: string) =>
    prisma.usuarios.create({ data: { nome, email: `${nome.toLowerCase()}@teste.com`, senha: 'hash-secreto', isAdmin: true } }); // SPEC-021: admin (RF-82)

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: bancoDescartavel() }) });
    ana = (await criarUsuario('Ana')).id;
    p1 = (await prisma.projetos.create({ data: { nome: 'P1', idStatus: 1 } })).id;
    p2 = (await prisma.projetos.create({ data: { nome: 'P2', idStatus: 1 } })).id;

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
      delete: (url: string) => auth(s.delete(url)),
    };
  };

  function esperaErro(res: request.Response, status: number) {
    expect(res.status).toBe(status);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'statusCode']);
    expect(typeof res.body.message).toBe('string');
  }

  // o usuário só tem vínculos de membro: nenhuma tarefa criada, nenhuma responsabilidade, nenhum comentário
  async function soMembro(nome: string, projetos: number[]) {
    const id = (await criarUsuario(nome)).id;
    for (const idProjeto of projetos) await prisma.usuariosProjetos.create({ data: { idUsuario: id, idProjeto } });
    expect(await prisma.tarefas.count({ where: { OR: [{ idUsuarioCriador: id }, { idUsuarioResponsavel: id }] } })).toBe(0);
    expect(await prisma.comentariosTarefas.count({ where: { idUsuario: id } })).toBe(0);
    return id;
  }

  // ---------- Entrego ----------

  it('CA-07: DELETE /usuarios/:id de membro de 1 projeto → 409 "membro de 1 projeto(s)"; nada desfeito', async () => {
    const bia = await soMembro('Bia', [p1]);
    const res = await http().delete(`/usuarios/${bia}`);
    esperaErro(res, 409);
    expect(res.body.message).toContain('membro de 1 projeto(s)');
    expect(res.body.message).not.toBe(EM_USO);
    // D-1: o vínculo não é desfeito e o usuário continua lá
    expect(await prisma.usuariosProjetos.count({ where: { idUsuario: bia } })).toBe(1);
    expect(await prisma.usuarios.count({ where: { id: bia } })).toBe(1);
  });

  it('CA-07: membro de 2 projetos → 409 "membro de 2 projeto(s)"', async () => {
    const caio = await soMembro('Caio', [p1, p2]);
    const res = await http().delete(`/usuarios/${caio}`);
    esperaErro(res, 409);
    expect(res.body.message).toContain('membro de 2 projeto(s)');
    expect(await prisma.usuariosProjetos.count({ where: { idUsuario: caio } })).toBe(2);
  });

  it('roteiro 6 (não-regrido, CA-09 + CA-12): removido dos projetos pela rota de membro, a exclusão passa → 200 sem senha', async () => {
    const bia = await soMembro('Bia', [p1, p2]);
    esperaErro(await http().delete(`/usuarios/${bia}`), 409);
    await http().delete(`/projetos/${p1}/membros/${bia}`).expect(200);
    await http().delete(`/projetos/${p2}/membros/${bia}`).expect(200);
    const res = await http().delete(`/usuarios/${bia}`).expect(200);
    expect(res.body.id).toBe(bia);
    expect(res.body).not.toHaveProperty('senha');
  });

  // ---------- Não-regrido ----------

  it('CA-08: não membro que criou tarefa → 409 "Registro em uso…"', async () => {
    const dani = (await criarUsuario('Dani')).id;
    await prisma.tarefas.create({ data: { nome: 'T', idStatus: 1, prioridade: 'Baixa', idUsuarioCriador: dani, idProjeto: p1 } });
    const res = await http().delete(`/usuarios/${dani}`);
    esperaErro(res, 409);
    expect(res.body.message).toBe(EM_USO);
  });

  it('CA-08: não membro que comentou → 409 "Registro em uso…"', async () => {
    const edu = (await criarUsuario('Edu')).id;
    const tarefa = await prisma.tarefas.create({ data: { nome: 'T', idStatus: 1, prioridade: 'Baixa', idUsuarioCriador: ana, idProjeto: p1 } });
    await prisma.comentariosTarefas.create({ data: { comentario: 'oi', idTarefa: tarefa.id, idUsuario: edu } });
    const res = await http().delete(`/usuarios/${edu}`);
    esperaErro(res, 409);
    expect(res.body.message).toBe(EM_USO);
  });

  it('CA-09: usuário sem vínculo nenhum → 200, sem senha, e some do banco', async () => {
    const fabi = (await criarUsuario('Fabi')).id;
    const res = await http().delete(`/usuarios/${fabi}`).expect(200);
    expect(res.body).toMatchObject({ id: fabi, nome: 'Fabi' });
    expect(res.body).not.toHaveProperty('senha');
    expect(await prisma.usuarios.count({ where: { id: fabi } })).toBe(0);
  });

  it('CA-09: usuário inexistente → 404 (inalterado)', async () => {
    esperaErro(await http().delete('/usuarios/9999'), 404);
  });

  it('CA-12: rotas de membro mantêm contrato e regras', async () => {
    const gui = (await criarUsuario('Gui')).id;

    const add = await http().post(`/projetos/${p1}/membros`, { idUsuario: gui }).expect(201);
    expect(add.body).toEqual({ id: gui, nome: 'Gui', email: 'gui@teste.com' });
    esperaErro(await http().post(`/projetos/${p1}/membros`, { idUsuario: gui }), 409);
    esperaErro(await http().post(`/projetos/${p1}/membros`, { idUsuario: 9999 }), 404);
    esperaErro(await http().post(`/projetos/9999/membros`, { idUsuario: gui }), 404);

    const lista = await http().get(`/projetos/${p1}/membros`).expect(200);
    expect(lista.body).toEqual([{ id: gui, nome: 'Gui', email: 'gui@teste.com' }]);
    esperaErro(await http().get(`/projetos/9999/membros`), 404);

    // RF-27: responsável por tarefa não sai
    const t = await prisma.tarefas.create({
      data: { nome: 'T', idStatus: 1, prioridade: 'Baixa', idUsuarioCriador: ana, idProjeto: p1, idUsuarioResponsavel: gui },
    });
    const recusa = await http().delete(`/projetos/${p1}/membros/${gui}`);
    esperaErro(recusa, 409);
    expect(recusa.body.message).toContain('responsável por 1 tarefa(s)');

    await prisma.tarefas.delete({ where: { id: t.id } });
    const rem = await http().delete(`/projetos/${p1}/membros/${gui}`).expect(200);
    expect(rem.body).toEqual({ id: gui, nome: 'Gui', email: 'gui@teste.com' });
    const naoMembro = await http().delete(`/projetos/${p1}/membros/${gui}`);
    esperaErro(naoMembro, 404);
    expect(naoMembro.body.message).toBe(`Usuario ${gui} não é membro do projeto ${p1}`);
  });
});
