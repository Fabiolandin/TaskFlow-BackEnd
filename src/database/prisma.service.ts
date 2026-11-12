import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as path from 'path';

//pasta do backend (src/database ou dist/database → ../..)
const RAIZ = path.join(__dirname, '..', '..');

//RF-95: o banco do DATABASE_URL (file:<caminho>, relativo à pasta do backend, como nas migrations);
//sem a variável, prisma/dev.db. Não depende da pasta de onde o servidor foi iniciado
export const caminhoDoBanco = (url: string | undefined): string => {
    const caminho = url ? url.replace(/^file:/, '') : './prisma/dev.db';
    return path.isAbsolute(caminho) ? caminho : path.join(RAIZ, caminho);
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
    constructor() {
        // No Prisma 7, passamos um objeto com a URL, não instanciamos o Database manualmente
        const adapter = new PrismaBetterSqlite3({
            url: caminhoDoBanco(process.env.DATABASE_URL),
        });

        // Passa o adaptador para o PrismaClient
        super({ adapter });
    }

    async onModuleInit() {
        await this.$connect();
    }
}
