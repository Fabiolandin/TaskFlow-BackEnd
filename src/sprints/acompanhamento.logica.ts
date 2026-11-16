// SPEC-025: status, números, atraso, risco e evolução ponderada do item (RF-122..RF-125). Funções puras:
// recebem os valores já lidos e os dias do calendário do dev (RF-105); datas AAAA-MM-DD.
import type { DiaCapacidade } from '../calendario/capacidade.logica';

export type StatusItem = 'Concluída' | 'Bloqueada' | 'Em andamento' | 'Não iniciada';

//RF-122, nesta ordem de precedência
export const statusDoItem = ({ evolucao, bloqueio, apontadas }: { evolucao: number; bloqueio: string | null; apontadas: number }): StatusItem => {
  if (evolucao >= 100) return 'Concluída';
  if (bloqueio && bloqueio.trim()) return 'Bloqueada';
  if (evolucao > 0 || apontadas > 0) return 'Em andamento';
  return 'Não iniciada';
};

//RF-123: % inteiro; sem horas planejadas não há consumo
export const consumoDoItem = (apontadas: number, planejadas: number): number | null =>
  planejadas > 0 ? Math.round((apontadas / planejadas) * 100) : null;

export const restantesDoItem = (planejadas: number, evolucao: number): number => Math.round((planejadas * (100 - evolucao)) / 100);

//dias úteis de `de` a `ate`, inclusive; sem uma das pontas → null
export const diasUteisNoPeriodo = (dias: DiaCapacidade[], de: string | null, ate: string | null): number | null => {
  if (!de || !ate) return null;
  return dias.filter((d) => d.util && d.data >= de && d.data <= ate).length;
};

//RF-124: dias úteis em (a, b] quando b > a; negativo dos de (b, a] quando b < a; 0 quando iguais
export const diasUteisEntre = (dias: DiaCapacidade[], a: string, b: string): number => {
  if (a === b) return 0;
  const [menor, maior, sinal] = a < b ? [a, b, 1] : [b, a, -1];
  return sinal * dias.filter((d) => d.util && d.data > menor && d.data <= maior).length;
};

//RF-124
export const atrasoDoItem = ({ concluida, entregaPrevista, dataEntregaReal, hoje, dias }: {
  concluida: boolean; entregaPrevista: string | null; dataEntregaReal: string | null; hoje: string; dias: DiaCapacidade[];
}): number | null => {
  if (!entregaPrevista) return null;
  if (concluida) return dataEntregaReal ? diasUteisEntre(dias, entregaPrevista, dataEntregaReal) : null;
  return entregaPrevista < hoje ? diasUteisEntre(dias, entregaPrevista, hoje) : null;
};

export const riscoDoItem = ({ concluida, atraso, entregaPrevista, entregaProjetada }: {
  concluida: boolean; atraso: number | null; entregaPrevista: string | null; entregaProjetada: string | null;
}): boolean => !concluida && atraso === null && !!entregaPrevista && !!entregaProjetada && entregaProjetada > entregaPrevista;

//RF-125: Σ(planejadas × evolução) ÷ Σ planejadas; itens sem horas não pesam; sem horas → null
export const evolucaoPonderada = (itens: { planejadas: number; evolucao: number }[]): number | null => {
  const total = itens.reduce((s, i) => s + i.planejadas, 0);
  if (total === 0) return null;
  return Math.round(itens.reduce((s, i) => s + i.planejadas * i.evolucao, 0) / total);
};
