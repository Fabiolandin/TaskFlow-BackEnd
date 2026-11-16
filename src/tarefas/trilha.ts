import type { Prisma, PrismaClient } from '@prisma/client';

export type Ancestral = { id: number; nome: string };
type Db = PrismaClient | Prisma.TransactionClient;

//limite de segurança contra ciclo na hierarquia
const PROFUNDIDADE_MAX = 20;

// Preenche `ancestrais` (da raiz até a mãe direta) de cada tarefa, em uma consulta por nível.
// Muda os objetos no lugar: serve para tarefas aninhadas em respostas maiores (fila, cronograma).
export async function anexarTrilhas<T extends { idTarefaPai: number | null; ancestrais: Ancestral[] }>(db: Db, tarefas: T[]): Promise<T[]> {
  const conhecidas = new Map<number, { nome: string; idTarefaPai: number | null }>();
  let faltam = [...new Set(tarefas.map((t) => t.idTarefaPai).filter((id): id is number => id !== null))];
  for (let nivel = 0; faltam.length > 0 && nivel < PROFUNDIDADE_MAX; nivel++) {
    const pais = await db.tarefas.findMany({ where: { id: { in: faltam } }, select: { id: true, nome: true, idTarefaPai: true } });
    for (const p of pais) conhecidas.set(p.id, { nome: p.nome, idTarefaPai: p.idTarefaPai });
    faltam = [...new Set(pais.map((p) => p.idTarefaPai).filter((id): id is number => id !== null && !conhecidas.has(id)))];
  }
  for (const t of tarefas) {
    const trilha: Ancestral[] = [];
    let id = t.idTarefaPai;
    while (id !== null && trilha.length < PROFUNDIDADE_MAX) {
      const pai = conhecidas.get(id);
      if (!pai) break;
      trilha.unshift({ id, nome: pai.nome });
      id = pai.idTarefaPai;
    }
    t.ancestrais = trilha;
  }
  return tarefas;
}
