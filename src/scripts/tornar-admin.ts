import 'reflect-metadata';
import { config } from 'dotenv';
import * as path from 'path';
//o .env da pasta do backend: o mesmo DATABASE_URL da API (RF-95)
config({ path: path.join(__dirname, '..', '..', '.env') });
import * as readline from 'readline';
import { PrismaService } from '../database/prisma.service';
import { ErroAdmin, Perguntar, lerArgumentos, tornarAdmin } from './tornar-admin.logica';

//`npm run admin -- <email> [--criar --nome "Nome"] [--forcar] [--sim]` (RF-87).
//Usa o mesmo PrismaService da API: mexe no mesmo banco que o servidor usa.

const perguntar: Perguntar = (texto, oculto = false) => {
  //sem terminal (ex.: rodando por um pipe), não há como confirmar nem digitar senha escondida
  if (!process.stdin.isTTY) {
    return Promise.reject(new ErroAdmin('Sem terminal interativo para confirmar. Rode num terminal, ou use --sim (não serve para --criar).'));
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      //escreve a pergunta e esconde o que é digitado
      const escrever = (rl as unknown as { _writeToOutput: (s: string) => void });
      process.stdout.write(texto);
      escrever._writeToOutput = () => {};
    }
    rl.question(oculto ? '' : texto, (resposta) => {
      if (oculto) process.stdout.write('\n');
      rl.close();
      resolve(resposta);
    });
  });
};

async function main() {
  const prisma = new PrismaService();
  try {
    const op = lerArgumentos(process.argv.slice(2));
    console.log(await tornarAdmin(prisma, op, perguntar));
  } catch (e) {
    console.error(e instanceof ErroAdmin ? e.message : e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
