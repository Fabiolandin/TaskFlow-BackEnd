import { PrismaClient } from '@prisma/client';
import { isEmail } from 'class-validator';
import * as bcrypt from 'bcrypt';
import { normalizarEmail } from '../usuarios/email';

//Lógica do comando `npm run admin` (RF-87): dá o papel de administrador pelo terminal do servidor.
//Não existe rota HTTP para isso: só quem tem acesso ao servidor (e ao banco) consegue rodar.

//erro esperado do comando: a mensagem vai para o terminal, sem stack
export class ErroAdmin extends Error {}

//pergunta no terminal; oculto = não mostra o que é digitado (senha)
export type Perguntar = (texto: string, oculto?: boolean) => Promise<string>;

export interface OpcoesAdmin {
  email: string;
  criar?: boolean;
  nome?: string;
  forcar?: boolean;
  sim?: boolean;
}

export const USO = 'Uso: npm run admin -- <email> [--criar --nome "Nome"] [--forcar] [--sim]';
const SENHA_MINIMA = 8;

//a senha nunca vem por argumento (ficaria no histórico do terminal e na lista de processos)
export function lerArgumentos(argv: string[]): OpcoesAdmin & { criar: boolean; forcar: boolean; sim: boolean } {
  const op = { email: '', criar: false, forcar: false, sim: false } as OpcoesAdmin & { criar: boolean; forcar: boolean; sim: boolean };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--criar') op.criar = true;
    else if (a === '--forcar') op.forcar = true;
    else if (a === '--sim') op.sim = true;
    else if (a === '--nome') {
      const nome = argv[++i];
      if (nome === undefined || nome.startsWith('--')) throw new ErroAdmin(`--nome precisa de um valor.\n${USO}`);
      op.nome = nome;
    } else if (a.startsWith('--')) throw new ErroAdmin(`Opção desconhecida: ${a}. A senha é sempre perguntada, nunca passada na linha.\n${USO}`);
    else if (op.email) throw new ErroAdmin(`Só um email por vez.\n${USO}`);
    else op.email = a;
  }
  if (!op.email) throw new ErroAdmin(USO);
  return op;
}

export async function tornarAdmin(prisma: PrismaClient, op: OpcoesAdmin, perguntar: Perguntar): Promise<string> {
  //para promover, vale o email como está gravado (há contas antigas sem formato válido, RF-83); para criar, precisa ser válido
  const email = normalizarEmail(op.email) as string;
  if (op.criar && !isEmail(email)) throw new ErroAdmin(`Email inválido: "${op.email}".`);

  //trava 1: com admin no banco, o caminho normal é a tela de Usuários; o comando é para o primeiro admin
  //ou para recuperar o acesso. Passar disso pede --forcar, de propósito
  const admins = await prisma.usuarios.findMany({ where: { isAdmin: true }, select: { email: true }, orderBy: { id: 'asc' } });
  const usuario = await prisma.usuarios.findUnique({ where: { email }, select: { id: true, nome: true, email: true, isAdmin: true } });

  if (usuario?.isAdmin && !op.criar) return `Nada mudou: ${usuario.email} já é administrador.`;
  if (admins.length && !op.forcar) {
    throw new ErroAdmin(
      `Já existe administrador: ${admins.map((a) => a.email).join(', ')}. ` +
        `Promova pela tela de Usuários, entrando como um deles. Se precisar mesmo usar o comando, rode de novo com --forcar.`,
    );
  }

  if (op.criar) {
    if (usuario) throw new ErroAdmin(`O email ${email} já existe. Para promover a conta que já existe, rode sem --criar.`);
    const nome = op.nome?.trim();
    if (!nome) throw new ErroAdmin(`Para criar, informe o nome: --nome "Nome Completo".`);
    //trava 2: senha perguntada escondida, duas vezes, com tamanho mínimo
    const senha = await perguntar('Senha do novo administrador: ', true);
    if (senha.length < SENHA_MINIMA) throw new ErroAdmin(`A senha precisa de pelo menos ${SENHA_MINIMA} caracteres. Nada foi gravado.`);
    if ((await perguntar('Repita a senha: ', true)) !== senha) throw new ErroAdmin('As senhas não conferem. Nada foi gravado.');
    await confirmar(op, email, `Vai CRIAR o administrador ${nome} <${email}>.`, perguntar);
    const novo = await prisma.usuarios.create({
      data: { nome, email, senha: bcrypt.hashSync(senha, 10), isAdmin: true },
      select: { id: true },
    });
    return `Administrador criado: #${novo.id} ${nome} <${email}>.`;
  }

  if (!usuario) throw new ErroAdmin(`Nenhum usuário com o email ${email}. Para criar um administrador novo, use --criar --nome "Nome".`);
  await confirmar(op, email, `Vai dar o papel de administrador a #${usuario.id} ${usuario.nome} <${usuario.email}>.`, perguntar);
  await prisma.usuarios.update({ where: { id: usuario.id }, data: { isAdmin: true } });
  return `Pronto: #${usuario.id} ${usuario.nome} <${usuario.email}> agora é administrador.`;
}

//trava 3: digitar o email de novo (um "s" ou um Enter por engano não promove ninguém); --sim pula, para automação
async function confirmar(op: OpcoesAdmin, email: string, aviso: string, perguntar: Perguntar) {
  if (op.sim) return;
  const resposta = await perguntar(`${aviso}\nPara confirmar, digite o email de novo: `);
  if (normalizarEmail(resposta) !== email) throw new ErroAdmin('Cancelado: o email não confere. Nada mudou.');
}
