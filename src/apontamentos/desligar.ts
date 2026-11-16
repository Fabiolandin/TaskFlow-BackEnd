import type { Prisma } from '@prisma/client';

// RF-134 (SPEC-026): o item some (removido, tarefa excluída, sprint apagada); os apontamentos dele ficam sem
// item e, se não tinham observação, recebem "Item removido: <nome>" (a regra de "sem item exige observação" segue valendo).
export const desligarApontamentos = async (tx: Prisma.TransactionClient, itens: { id: number; nome: string | null }[]) => {
  for (const item of itens) {
    const observacao = `Item removido: ${item.nome ?? ''}`.trim();
    await tx.apontamentos.updateMany({ where: { idItemSprint: item.id, OR: [{ observacao: null }, { observacao: '' }] }, data: { observacao } });
    await tx.apontamentos.updateMany({ where: { idItemSprint: item.id }, data: { idItemSprint: null } });
  }
};
