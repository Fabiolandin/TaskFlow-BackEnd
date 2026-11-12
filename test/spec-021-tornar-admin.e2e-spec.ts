/**
 * SPEC-021, emenda 1.1: comando `npm run admin` (RF-87).
 *
 * CA cobertos: CA-26..CA-35.
 *
 * Testa a lógica do comando (tornarAdmin) e a leitura dos argumentos (lerArgumentos) sobre um SQLite
 * descartável, criado a partir das migrations do projeto. As perguntas do terminal são simuladas por uma
 * fila de respostas. O prisma/dev.db não é tocado.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ErroAdmin, lerArgumentos, tornarAdmin } from '../src/scripts/tornar-admin.logica';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

function criarBancoDescartavel(): string {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-admin-')), 'test.db');
  const db = new Database(arquivo);
  for (const pasta of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = path.join(MIGRATIONS_DIR, pasta, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  return arquivo;
}

//responde às perguntas na ordem; guarda o que foi perguntado
const respostas = (...fila: string[]) => {
  const perguntas: { texto: string; oculto: boolean }[] = [];
  const perguntar = async (texto: string, oculto = false) => {
    perguntas.push({ texto, oculto });
    if (!fila.length) throw new Error('pergunta sem resposta: ' + texto);
    return fila.shift()!;
  };
  return { perguntar, perguntas };
};

describe('SPEC-021 emenda 1.1: comando npm run admin', () => {
  let prisma: PrismaClient;
  let ana: { id: number };
  const senha = bcrypt.hashSync('senha-certa', 10);

  beforeEach(async () => {
    prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: criarBancoDescartavel() }) });
    ana = await prisma.usuarios.create({ data: { nome: 'Ana', email: 'ana@teste.com', senha } });
    await prisma.usuarios.create({ data: { nome: 'Bia', email: 'bia@teste.com', senha } });
  });
  afterEach(async () => prisma.$disconnect());

  const admins = async () => (await prisma.usuarios.findMany({ where: { isAdmin: true }, select: { email: true } })).map((u) => u.email);

  it('CA-26: sem admin no banco, promove o usuário depois de digitar o email de novo', async () => {
    const r = respostas('ana@teste.com');
    const msg = await tornarAdmin(prisma, { email: 'ana@teste.com' }, r.perguntar);
    expect(await admins()).toEqual(['ana@teste.com']);
    expect(msg).toContain('ana@teste.com');
    expect(r.perguntas[0].texto).toContain('Ana');
  });

  it('CA-27: confirmação diferente do email cancela e nada muda', async () => {
    await expect(tornarAdmin(prisma, { email: 'ana@teste.com' }, respostas('sim').perguntar)).rejects.toThrow('Cancelado');
    expect(await admins()).toEqual([]);
  });

  it('CA-28: com --sim, não pergunta nada', async () => {
    const r = respostas();
    await tornarAdmin(prisma, { email: 'ana@teste.com', sim: true }, r.perguntar);
    expect(r.perguntas).toHaveLength(0);
    expect(await admins()).toEqual(['ana@teste.com']);
  });

  it('CA-29: já existindo admin, recusa sem --forcar, dizendo quem é o admin; com --forcar, promove', async () => {
    await prisma.usuarios.update({ where: { email: 'bia@teste.com' }, data: { isAdmin: true } });
    const erro = tornarAdmin(prisma, { email: 'ana@teste.com', sim: true }, respostas().perguntar);
    await expect(erro).rejects.toBeInstanceOf(ErroAdmin);
    await expect(tornarAdmin(prisma, { email: 'ana@teste.com', sim: true }, respostas().perguntar)).rejects.toThrow(/bia@teste\.com.*--forcar|--forcar.*bia@teste\.com/s);
    expect(await admins()).toEqual(['bia@teste.com']);

    await tornarAdmin(prisma, { email: 'ana@teste.com', sim: true, forcar: true }, respostas().perguntar);
    expect((await admins()).sort()).toEqual(['ana@teste.com', 'bia@teste.com']);
  });

  it('CA-30: email com espaços e maiúsculas acha o usuário; conta antiga sem formato válido também é promovida; criar com email inválido é recusado', async () => {
    await tornarAdmin(prisma, { email: '  ANA@Teste.com ', sim: true }, respostas().perguntar);
    expect(await admins()).toEqual(['ana@teste.com']);
    await prisma.usuarios.create({ data: { nome: 'Antigo', email: 'usuario1', senha } });
    await tornarAdmin(prisma, { email: 'Usuario1', sim: true, forcar: true }, respostas().perguntar);
    expect((await admins()).sort()).toEqual(['ana@teste.com', 'usuario1']);
    await expect(tornarAdmin(prisma, { email: 'zeca', criar: true, nome: 'Zeca', forcar: true }, respostas('senha-forte-1', 'senha-forte-1').perguntar)).rejects.toThrow('Email inválido');
  });

  it('CA-31: email que não existe é recusado e aponta o --criar', async () => {
    await expect(tornarAdmin(prisma, { email: 'zeca@teste.com', sim: true }, respostas().perguntar)).rejects.toThrow('--criar');
    expect(await prisma.usuarios.count()).toBe(2);
  });

  it('CA-32: quem já é admin fica como está (sem erro, nada muda)', async () => {
    await prisma.usuarios.update({ where: { id: ana.id }, data: { isAdmin: true } });
    const msg = await tornarAdmin(prisma, { email: 'ana@teste.com', sim: true }, respostas().perguntar);
    expect(msg).toContain('já é administrador');
    expect(await admins()).toEqual(['ana@teste.com']);
  });

  it('CA-33: --criar cria o admin com a senha perguntada escondida, duas vezes, gravada só como hash', async () => {
    const r = respostas('senha-forte-1', 'senha-forte-1', 'novo@teste.com');
    await tornarAdmin(prisma, { email: 'Novo@teste.com', criar: true, nome: 'Novo Admin' }, r.perguntar);
    const novo = await prisma.usuarios.findUnique({ where: { email: 'novo@teste.com' } });
    expect(novo).toMatchObject({ nome: 'Novo Admin', isAdmin: true });
    expect(novo!.senha).not.toBe('senha-forte-1');
    expect(bcrypt.compareSync('senha-forte-1', novo!.senha)).toBe(true);
    expect(r.perguntas.slice(0, 2).every((p) => p.oculto)).toBe(true);
  });

  it('CA-34: --criar recusa senha curta, senhas diferentes, nome vazio e email que já existe; nada é gravado', async () => {
    const tentar = (op: object, ...fila: string[]) => tornarAdmin(prisma, { email: 'novo@teste.com', criar: true, nome: 'Novo', ...op }, respostas(...fila).perguntar);
    await expect(tentar({}, 'curta', 'curta')).rejects.toThrow('8 caracteres');
    await expect(tentar({}, 'senha-forte-1', 'senha-forte-2')).rejects.toThrow('não conferem');
    await expect(tentar({ nome: '  ' }, 'senha-forte-1', 'senha-forte-1')).rejects.toThrow('--nome');
    await expect(tentar({ email: 'ana@teste.com' }, 'senha-forte-1', 'senha-forte-1')).rejects.toThrow('já existe');
    expect(await prisma.usuarios.count()).toBe(2);
    expect(await admins()).toEqual([]);
  });

  it('CA-35: argumentos: email, --criar, --nome, --forcar e --sim; opção desconhecida ou sem email é recusada', () => {
    expect(lerArgumentos(['ana@teste.com'])).toEqual({ email: 'ana@teste.com', criar: false, forcar: false, sim: false });
    expect(lerArgumentos(['--criar', '--nome', 'Ana Ribeiro', 'ana@teste.com', '--forcar', '--sim'])).toEqual({
      email: 'ana@teste.com', criar: true, nome: 'Ana Ribeiro', forcar: true, sim: true,
    });
    expect(() => lerArgumentos([])).toThrow('Uso:');
    expect(() => lerArgumentos(['ana@teste.com', '--senha', 'x'])).toThrow('--senha');
    expect(() => lerArgumentos(['ana@teste.com', '--nome'])).toThrow('--nome');
  });
});
