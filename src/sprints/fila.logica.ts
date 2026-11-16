// RF-113 (SPEC-024): fila de um dev. Função pura, sem banco: recebe os dias com capacidade (RF-105),
// já começando na data de partida, o fim da sprint e os itens na ordem, cada um com seus minutos.
import type { DiaCapacidade } from '../calendario/capacidade.logica';

export interface ItemDaFila {
  id: number;
  minutos: number;
}

export interface PosicaoNaFila {
  id: number;
  //dia do primeiro minuto consumido; null se não houver capacidade no horizonte
  inicio: string | null;
  //dia do último minuto consumido; null se não couber no horizonte
  entrega: string | null;
  //minutos consumidos até o fim da sprint (inclusive) e o resto
  minutosNaSprint: number;
  minutosTransbordo: number;
  //último dia, até o fim da sprint, em que o item consumiu minutos (entrega da parte que fica)
  entregaNaSprint: string | null;
}

// Cada item consome a capacidade dia a dia, pulando dias sem capacidade; o próximo começa onde o
// anterior parou, inclusive no meio do dia. Dia todo consumido: o próximo item começa no próximo dia
// com capacidade. Item de 0 minutos fica no dia em que a fila está, sem empurrar o próximo.
export const calcularFila = (dias: DiaCapacidade[], fimSprint: string, itens: ItemDaFila[]): PosicaoNaFila[] => {
  let cursor = 0;
  let livre = dias[0]?.capacidade ?? 0;

  //avança até um dia com capacidade sobrando; false se acabou o horizonte
  const irParaDiaComCapacidade = (): boolean => {
    while (cursor < dias.length && livre <= 0) {
      cursor++;
      livre = dias[cursor]?.capacidade ?? 0;
    }
    return cursor < dias.length;
  };

  return itens.map(({ id, minutos }) => {
    if (!irParaDiaComCapacidade()) {
      return { id, inicio: null, entrega: null, minutosNaSprint: 0, minutosTransbordo: minutos, entregaNaSprint: null };
    }
    const inicio = dias[cursor].data;
    if (minutos <= 0) {
      return { id, inicio, entrega: inicio, minutosNaSprint: 0, minutosTransbordo: 0, entregaNaSprint: null };
    }

    let falta = minutos;
    let naSprint = 0;
    let entregaNaSprint: string | null = null;
    while (falta > 0) {
      if (!irParaDiaComCapacidade()) {
        return { id, inicio, entrega: null, minutosNaSprint: naSprint, minutosTransbordo: minutos - naSprint, entregaNaSprint };
      }
      const dia = dias[cursor].data;
      const usa = Math.min(livre, falta);
      falta -= usa;
      livre -= usa;
      if (dia <= fimSprint) {
        naSprint += usa;
        entregaNaSprint = dia;
      }
      if (falta === 0) {
        return { id, inicio, entrega: dia, minutosNaSprint: naSprint, minutosTransbordo: minutos - naSprint, entregaNaSprint };
      }
    }
    //inalcançável: o laço sempre retorna
    return { id, inicio, entrega: null, minutosNaSprint: naSprint, minutosTransbordo: minutos - naSprint, entregaNaSprint };
  });
};
