/**
 * SPEC-024: fila do dev (RF-113), função pura, sem banco.
 *
 * CA cobertos: CA-22..CA-27, CA-46 (casos de teste da §7 "Fila" do REQUISITOS-sprint-apontamento.md).
 * Calendário: 8h de segunda a sexta; 2026-03-02 é segunda-feira. Sprint de exemplo: 02/03 a 06/03 (40h).
 */
import { capacidadeDosDias, type Calendario } from '../calendario/capacidade.logica';
import { calcularFila } from './fila.logica';

const OITO_HORAS: Calendario = {
  jornadas: [{ vigencia: '2026-01-01', seg: 480, ter: 480, qua: 480, qui: 480, sex: 480, sab: 0, dom: 0 }],
  feriados: [],
  ausencias: [],
};
const dias = (cal: Calendario = OITO_HORAS, inicio = '2026-03-02', fim = '2026-04-30') => capacidadeDosDias(inicio, fim, cal);
const h = (horas: number) => horas * 60;
const FIM = '2026-03-06';

describe('SPEC-024: fila (RF-113)', () => {
  it('CA-22: item de 4h depois de item de 6h, jornada de 8h: começa no dia 1 e termina no dia 2', () => {
    const [a, b] = calcularFila(dias(), FIM, [{ id: 1, minutos: h(6) }, { id: 2, minutos: h(4) }]);
    expect(a).toMatchObject({ id: 1, inicio: '2026-03-02', entrega: '2026-03-02' });
    expect(b).toMatchObject({ id: 2, inicio: '2026-03-02', entrega: '2026-03-03' });
  });

  it('CA-23: item de 20h com jornada de 8h ocupa 3 dias úteis', () => {
    const [a] = calcularFila(dias(), FIM, [{ id: 1, minutos: h(20) }]);
    expect(a).toMatchObject({ inicio: '2026-03-02', entrega: '2026-03-04' });
  });

  it('CA-23: atravessa o fim de semana contando só dias úteis', () => {
    const [, b] = calcularFila(dias(), '2026-03-13', [{ id: 1, minutos: h(32) }, { id: 2, minutos: h(16) }]);
    // 32h = seg a qui; 16h = sex e a segunda seguinte
    expect(b).toMatchObject({ inicio: '2026-03-06', entrega: '2026-03-09' });
  });

  it('CA-24: dia sem capacidade (feriado, férias) é pulado', () => {
    const cal: Calendario = {
      ...OITO_HORAS,
      feriados: [{ data: '2026-03-03', nome: 'F', minutosDescontados: null }],
      ausencias: [{ tipo: 'Ferias', dataInicio: '2026-03-05', dataFim: '2026-03-05', minutosPorDia: null }],
    };
    const [a] = calcularFila(dias(cal), '2026-03-13', [{ id: 1, minutos: h(20) }]);
    // 02 (8h), 03 feriado, 04 (8h), 05 férias, 06 (4h)
    expect(a).toMatchObject({ inicio: '2026-03-02', entrega: '2026-03-06' });
  });

  it('CA-24: item que começaria num dia sem capacidade começa no próximo útil', () => {
    const cal: Calendario = { ...OITO_HORAS, feriados: [{ data: '2026-03-02', nome: 'F', minutosDescontados: null }] };
    const [a] = calcularFila(dias(cal), FIM, [{ id: 1, minutos: h(2) }]);
    expect(a).toMatchObject({ inicio: '2026-03-03', entrega: '2026-03-03' });
  });

  it('CA-25: item de 8h exatas: o próximo começa no dia útil seguinte', () => {
    const [, b] = calcularFila(dias(), FIM, [{ id: 1, minutos: h(8) }, { id: 2, minutos: h(4) }]);
    expect(b).toMatchObject({ inicio: '2026-03-03', entrega: '2026-03-03' });
  });

  it('CA-26: item de 0h fica onde a fila está e não empurra o próximo', () => {
    const [, zero, c] = calcularFila(dias(), FIM, [{ id: 1, minutos: h(4) }, { id: 2, minutos: 0 }, { id: 3, minutos: h(4) }]);
    expect(zero).toMatchObject({ inicio: '2026-03-02', entrega: '2026-03-02', minutosNaSprint: 0, minutosTransbordo: 0 });
    expect(c).toMatchObject({ inicio: '2026-03-02', entrega: '2026-03-02' });
  });

  it('CA-26: item de 0h depois de um dia cheio fica no próximo dia útil', () => {
    const [, zero] = calcularFila(dias(), FIM, [{ id: 1, minutos: h(8) }, { id: 2, minutos: 0 }]);
    expect(zero).toMatchObject({ inicio: '2026-03-03', entrega: '2026-03-03' });
  });

  it('CA-27: sobram 4h na sprint e o próximo tem 10h → 4h na sprint e 6h de transbordo', () => {
    const [a, b] = calcularFila(dias(), FIM, [{ id: 1, minutos: h(36) }, { id: 2, minutos: h(10) }]);
    expect(a).toMatchObject({ minutosNaSprint: h(36), minutosTransbordo: 0, entrega: '2026-03-06', entregaNaSprint: '2026-03-06' });
    expect(b).toMatchObject({ inicio: '2026-03-06', entrega: '2026-03-09', minutosNaSprint: h(4), minutosTransbordo: h(6), entregaNaSprint: '2026-03-06' });
  });

  it('CA-27: item que começaria depois do fim transborda inteiro, com a data calculada depois do fim', () => {
    const [, b] = calcularFila(dias(), FIM, [{ id: 1, minutos: h(40) }, { id: 2, minutos: h(8) }]);
    expect(b).toMatchObject({ inicio: '2026-03-09', entrega: '2026-03-09', minutosNaSprint: 0, minutosTransbordo: h(8), entregaNaSprint: null });
  });

  it('sem capacidade no horizonte: entrega nula e tudo como transbordo', () => {
    const semJornada: Calendario = { jornadas: [], feriados: [], ausencias: [] };
    const [a] = calcularFila(dias(semJornada), FIM, [{ id: 1, minutos: h(2) }]);
    expect(a).toMatchObject({ inicio: null, entrega: null, minutosNaSprint: 0, minutosTransbordo: h(2) });
  });

  it('a partida no meio da sprint começa a fila naquele dia (projeção a partir de hoje)', () => {
    const [a] = calcularFila(dias(OITO_HORAS, '2026-03-04'), FIM, [{ id: 1, minutos: h(12) }]);
    expect(a).toMatchObject({ inicio: '2026-03-04', entrega: '2026-03-05' });
  });
});
