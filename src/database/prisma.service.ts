import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
    constructor() {
        // No Prisma 7, passamos um objeto com a URL, não instanciamos o Database manualmente
        const adapter = new PrismaBetterSqlite3({
            url: './prisma/dev.db'
        });

        // Passa o adaptador para o PrismaClient
        super({ adapter });
    }

    async onModuleInit() {
        await this.$connect();
    }
}
