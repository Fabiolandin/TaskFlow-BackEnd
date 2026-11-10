import { Prisma, PrismaClient } from '@prisma/client';

// RF-56: ids dos registros cujo nome contém `busca`, com `%` e `_` como caracteres comuns.
// O `contains` do Prisma no SQLite não escapa os curingas do LIKE (SPEC-016, desvio A-2), por isso
// o predicado vai cru, com ESCAPE e o valor parametrizado. O LIKE do SQLite ignora maiúsculas só nas
// letras sem acento, o limite aceito no RF-56.
export async function idsComNome(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  tabela: 'Tarefas' | 'Projetos',
  busca: string,
): Promise<number[]> {
  const padrao = `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const linhas = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${tabela}"`)} WHERE "nome" LIKE ${padrao} ESCAPE '\\'`,
  );
  return linhas.map((l) => Number(l.id));
}
