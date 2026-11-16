/**
 * SPEC-023: capacidade do dia e do período (RF-105), função pura, sem banco.
 *
 * CA cobertos: CA-15..CA-19, CA-21, CA-22, CA-24 (casos de teste da §7 do REQUISITOS-sprint-apontamento.md).
 * Datas de referência: 2026-03-02 é segunda-feira.
 */
import { capacidadeDosDias, capacidadeTotal, type Calendario, type JornadaCalc } from './capacidade.logica';

const OITO_HORAS_SEG_SEX: JornadaCalc = { vigencia: '2026-01-01', seg: 480, ter: 480, qua: 480, qui: 480, sex: 480, sab: 0, dom: 0 };
const vazio = (extra: Partial<Calendario> = {}): Calendario => ({ jornadas: [OITO_HORAS_SEG_SEX], feriados: [], ausencias: [], ...extra });
const dia = (cal: Calendario, data: string) => capacidadeDosDias(data, data, cal)[0];

describe('SPEC-023: capacidade (RF-105)', () => {
  it('semana comum: 5 dias de 8h, fim de semana zerado', () => {
    const dias = capacidadeDosDias('2026-03-02', '2026-03-08', vazio());
    expect(dias.map((d) => d.capacidade)).toEqual([480, 480, 480, 480, 480, 0, 0]);
    expect(capacidadeTotal(dias)).toBe(2400);
  });

  it('CA-15: feriado numa quarta zera a quarta; feriado num sábado não muda nada', () => {
    const cal = vazio({ feriados: [
      { data: '2026-03-04', nome: 'Quarta', minutosDescontados: null },
      { data: '2026-03-07', nome: 'Sábado', minutosDescontados: null },
    ] });
    const quarta = dia(cal, '2026-03-04');
    expect(quarta.capacidade).toBe(0);
    expect(quarta.motivo).toBe('feriado: Quarta');
    expect(capacidadeTotal(capacidadeDosDias('2026-03-02', '2026-03-08', cal))).toBe(1920);
    expect(dia(cal, '2026-03-07').capacidade).toBe(0);
    expect(capacidadeTotal(capacidadeDosDias('2026-03-07', '2026-03-08', cal))).toBe(0);
  });

  it('CA-16: feriado de meio período (240 min) numa terça de 480 → 240', () => {
    const cal = vazio({ feriados: [{ data: '2026-03-03', nome: 'Meio', minutosDescontados: 240 }] });
    const terca = dia(cal, '2026-03-03');
    expect(terca.capacidade).toBe(240);
    expect(terca.desconto).toBe(240);
  });

  it('CA-17: férias que começam antes da sprint descontam só os dias dentro dela', () => {
    const cal = vazio({ ausencias: [{ tipo: 'Ferias', dataInicio: '2026-02-20', dataFim: '2026-03-05', minutosPorDia: null }] });
    const dias = capacidadeDosDias('2026-03-02', '2026-03-13', cal);
    expect(dias.slice(0, 4).map((d) => d.capacidade)).toEqual([0, 0, 0, 0]);
    expect(dias[0].motivo).toBe('ausencia: Ferias');
    expect(dias[4].capacidade).toBe(480);
    // sexta 06/03 + segunda a sexta seguintes = 6 dias de 8h
    expect(capacidadeTotal(dias)).toBe(6 * 480);
  });

  it('CA-18: feriado e ausência no mesmo dia não descontam duas vezes', () => {
    const inteiro = vazio({
      feriados: [{ data: '2026-03-03', nome: 'F', minutosDescontados: null }],
      ausencias: [{ tipo: 'Folga', dataInicio: '2026-03-03', dataFim: '2026-03-03', minutosPorDia: null }],
    });
    expect(dia(inteiro, '2026-03-03').capacidade).toBe(0);

    const parcial = vazio({
      feriados: [{ data: '2026-03-03', nome: 'F', minutosDescontados: 240 }],
      ausencias: [{ tipo: 'Outro', dataInicio: '2026-03-03', dataFim: '2026-03-03', minutosPorDia: 120 }],
    });
    const terca = dia(parcial, '2026-03-03');
    expect(terca.desconto).toBe(240);
    expect(terca.capacidade).toBe(240);
    expect(terca.motivo).toBe('feriado: F');
  });

  it('CA-18: nunca negativa; ausência maior que o feriado vira o motivo; empate fica com feriado', () => {
    const cal = vazio({
      feriados: [{ data: '2026-03-03', nome: 'F', minutosDescontados: 120 }],
      ausencias: [{ tipo: 'Atestado', dataInicio: '2026-03-03', dataFim: '2026-03-04', minutosPorDia: 600 }],
    });
    const terca = dia(cal, '2026-03-03');
    expect(terca.capacidade).toBe(0);
    expect(terca.motivo).toBe('ausencia: Atestado');

    const empate = vazio({
      feriados: [{ data: '2026-03-03', nome: 'F', minutosDescontados: 120 }],
      ausencias: [{ tipo: 'Outro', dataInicio: '2026-03-03', dataFim: '2026-03-03', minutosPorDia: 120 }],
    });
    expect(dia(empate, '2026-03-03').motivo).toBe('feriado: F');
  });

  it('ausências sobrepostas do mesmo dev valem pelo maior desconto', () => {
    const cal = vazio({ ausencias: [
      { tipo: 'Outro', dataInicio: '2026-03-02', dataFim: '2026-03-06', minutosPorDia: 60 },
      { tipo: 'Folga', dataInicio: '2026-03-03', dataFim: '2026-03-03', minutosPorDia: 180 },
    ] });
    expect(dia(cal, '2026-03-03').capacidade).toBe(300);
    expect(dia(cal, '2026-03-02').capacidade).toBe(420);
  });

  it('CA-19: jornada nova não altera dias anteriores à vigência', () => {
    const cal = vazio({ jornadas: [
      OITO_HORAS_SEG_SEX,
      { vigencia: '2026-07-01', seg: 360, ter: 360, qua: 360, qui: 360, sex: 360, sab: 0, dom: 0 },
    ] });
    expect(dia(cal, '2026-03-03').capacidade).toBe(480);
    expect(dia(cal, '2026-08-04').capacidade).toBe(360);
    expect(dia(cal, '2026-06-30').capacidade).toBe(480);
    expect(dia(cal, '2026-07-01').capacidade).toBe(360);
  });

  it('CA-21: dia útil = capacidade > 0 (meio feriado ainda é útil; feriado inteiro, férias e sábado não)', () => {
    const cal = vazio({
      feriados: [
        { data: '2026-03-03', nome: 'Meio', minutosDescontados: 240 },
        { data: '2026-03-04', nome: 'Inteiro', minutosDescontados: null },
      ],
      ausencias: [{ tipo: 'Ferias', dataInicio: '2026-03-05', dataFim: '2026-03-05', minutosPorDia: null }],
    });
    const dias = capacidadeDosDias('2026-03-02', '2026-03-07', cal);
    expect(dias.map((d) => d.util)).toEqual([true, true, false, false, true, false]);
  });

  it('CA-22: sem jornada, todos os dias com 0 e não úteis', () => {
    const dias = capacidadeDosDias('2026-03-02', '2026-03-08', vazio({ jornadas: [] }));
    expect(dias.every((d) => d.capacidade === 0 && !d.util && d.jornada === 0)).toBe(true);
  });

  it('dias antes da primeira vigência não têm jornada', () => {
    const cal = vazio({ jornadas: [{ ...OITO_HORAS_SEG_SEX, vigencia: '2026-03-04' }] });
    const dias = capacidadeDosDias('2026-03-02', '2026-03-05', cal);
    expect(dias.map((d) => d.capacidade)).toEqual([0, 0, 480, 480]);
  });

  it('devolve as datas no formato AAAA-MM-DD, atravessando mês e ano', () => {
    const dias = capacidadeDosDias('2026-12-30', '2027-01-02', vazio());
    expect(dias.map((d) => d.data)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});
