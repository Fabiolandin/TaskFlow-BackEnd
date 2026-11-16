/**
 * SPEC-025: status, números, atraso, risco e evolução ponderada do item (RF-122..RF-125), funções puras.
 *
 * CA cobertos: CA-08..CA-17, CA-26 (casos da §7 "Status, evolução e atraso" do REQUISITOS-sprint-apontamento.md).
 * Calendário: 8h de segunda a sexta; 2026-03-02 é segunda-feira.
 */
import { capacidadeDosDias, type Calendario } from '../calendario/capacidade.logica';
import { atrasoDoItem, consumoDoItem, diasUteisEntre, diasUteisNoPeriodo, evolucaoPonderada, restantesDoItem, riscoDoItem, statusDoItem } from './acompanhamento.logica';

const OITO_HORAS: Calendario = {
  jornadas: [{ vigencia: '2026-01-01', seg: 480, ter: 480, qua: 480, qui: 480, sex: 480, sab: 0, dom: 0 }],
  feriados: [],
  ausencias: [],
};
const dias = capacidadeDosDias('2026-02-01', '2026-04-30', OITO_HORAS);

describe('SPEC-025: acompanhamento do item', () => {
  it('CA-08: status derivado na ordem de precedência', () => {
    expect(statusDoItem({ evolucao: 0, bloqueio: null, apontadas: 0 })).toBe('Não iniciada');
    expect(statusDoItem({ evolucao: 0, bloqueio: null, apontadas: 30 })).toBe('Em andamento');
    expect(statusDoItem({ evolucao: 10, bloqueio: '', apontadas: 0 })).toBe('Em andamento');
    expect(statusDoItem({ evolucao: 100, bloqueio: 'aguardando cliente', apontadas: 0 })).toBe('Concluída');
    expect(statusDoItem({ evolucao: 30, bloqueio: 'aguardando cliente', apontadas: 60 })).toBe('Bloqueada');
    expect(statusDoItem({ evolucao: 30, bloqueio: '   ', apontadas: 0 })).toBe('Em andamento');
  });

  it('CA-09: consumo = apontadas ÷ planejadas, em %; planejadas 0 → null', () => {
    expect(consumoDoItem(90, 60)).toBe(150);
    expect(consumoDoItem(30, 120)).toBe(25);
    expect(consumoDoItem(30, 0)).toBeNull();
  });

  it('CA-10: restantes = planejadas × (1 − evolução), arredondado', () => {
    expect(restantesDoItem(480, 25)).toBe(360);
    expect(restantesDoItem(420, 33)).toBe(281);
    expect(restantesDoItem(480, 100)).toBe(0);
  });

  it('CA-11: dias úteis do previsto, inclusive', () => {
    expect(diasUteisNoPeriodo(dias, '2026-03-02', '2026-03-09')).toBe(6);
    expect(diasUteisNoPeriodo(dias, '2026-03-02', '2026-03-02')).toBe(1);
    expect(diasUteisNoPeriodo(dias, null, '2026-03-02')).toBeNull();
  });

  it('diasUteisEntre conta (a, b] e é negativo quando b < a', () => {
    expect(diasUteisEntre(dias, '2026-03-02', '2026-03-02')).toBe(0);
    expect(diasUteisEntre(dias, '2026-03-02', '2026-03-04')).toBe(2);
    expect(diasUteisEntre(dias, '2026-03-04', '2026-03-02')).toBe(-2);
  });

  it('CA-12: concluída 2 dias úteis antes = −2; com fim de semana no meio conta só dias úteis', () => {
    expect(atrasoDoItem({ concluida: true, entregaPrevista: '2026-03-06', dataEntregaReal: '2026-03-04', hoje: '2026-03-20', dias })).toBe(-2);
    // prevista na terça 10/03, entregue na sexta 06/03: seg 09 e ter 10 = −2
    expect(atrasoDoItem({ concluida: true, entregaPrevista: '2026-03-10', dataEntregaReal: '2026-03-06', hoje: '2026-03-20', dias })).toBe(-2);
    expect(atrasoDoItem({ concluida: true, entregaPrevista: '2026-03-06', dataEntregaReal: '2026-03-06', hoje: '2026-03-20', dias })).toBe(0);
    expect(atrasoDoItem({ concluida: true, entregaPrevista: '2026-03-06', dataEntregaReal: '2026-03-10', hoje: '2026-03-20', dias })).toBe(2);
  });

  it('CA-13: não concluída com prevista há 3 dias úteis = +3', () => {
    // prevista na quinta 05/03; hoje terça 10/03 → sex, seg, ter = 3
    expect(atrasoDoItem({ concluida: false, entregaPrevista: '2026-03-05', dataEntregaReal: null, hoje: '2026-03-10', dias })).toBe(3);
  });

  it('CA-14: não concluída com prevista hoje, no futuro ou sem prevista → null', () => {
    expect(atrasoDoItem({ concluida: false, entregaPrevista: '2026-03-10', dataEntregaReal: null, hoje: '2026-03-10', dias })).toBeNull();
    expect(atrasoDoItem({ concluida: false, entregaPrevista: '2026-03-12', dataEntregaReal: null, hoje: '2026-03-10', dias })).toBeNull();
    expect(atrasoDoItem({ concluida: false, entregaPrevista: null, dataEntregaReal: null, hoje: '2026-03-10', dias })).toBeNull();
    expect(atrasoDoItem({ concluida: true, entregaPrevista: null, dataEntregaReal: '2026-03-10', hoje: '2026-03-10', dias })).toBeNull();
  });

  it('CA-15: risco = não concluída, sem atraso, projetado depois do previsto', () => {
    expect(riscoDoItem({ concluida: false, atraso: null, entregaPrevista: '2026-03-10', entregaProjetada: '2026-03-11' })).toBe(true);
    expect(riscoDoItem({ concluida: false, atraso: null, entregaPrevista: '2026-03-10', entregaProjetada: '2026-03-10' })).toBe(false);
    expect(riscoDoItem({ concluida: false, atraso: 2, entregaPrevista: '2026-03-10', entregaProjetada: '2026-03-12' })).toBe(false);
    expect(riscoDoItem({ concluida: true, atraso: null, entregaPrevista: '2026-03-10', entregaProjetada: '2026-03-12' })).toBe(false);
    expect(riscoDoItem({ concluida: false, atraso: null, entregaPrevista: null, entregaProjetada: '2026-03-12' })).toBe(false);
  });

  it('CA-16: evolução ponderada, não média simples', () => {
    expect(evolucaoPonderada([{ planejadas: 480, evolucao: 100 }, { planejadas: 120, evolucao: 0 }])).toBe(80);
  });

  it('CA-17: item com 0 planejadas não pesa; sem horas → null', () => {
    expect(evolucaoPonderada([{ planejadas: 480, evolucao: 50 }, { planejadas: 0, evolucao: 0 }])).toBe(50);
    expect(evolucaoPonderada([{ planejadas: 0, evolucao: 30 }])).toBeNull();
    expect(evolucaoPonderada([])).toBeNull();
  });
});
