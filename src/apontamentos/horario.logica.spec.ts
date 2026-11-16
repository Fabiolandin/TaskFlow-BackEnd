/**
 * SPEC-026: horários do apontamento (RF-128), funções puras.
 * CA cobertos: CA-21 (e a base do CA-01..CA-03).
 */
import { formatarHora, horasDecimais, lerHora, sobrepoe } from './horario.logica';

describe('SPEC-026: horários do apontamento', () => {
  it('lê HH:MM de 00:00 a 23:59 em minutos', () => {
    expect(lerHora('00:00')).toBe(0);
    expect(lerHora('08:00')).toBe(480);
    expect(lerHora('09:20')).toBe(560);
    expect(lerHora('23:59')).toBe(1439);
  });

  it('recusa hora fora do formato', () => {
    for (const ruim of ['24:00', '8:00', '08:0', '08:60', '0800', '', 'ab:cd', null, undefined, 480]) expect(lerHora(ruim as unknown)).toBeNull();
  });

  it('formata minutos como HH:MM', () => {
    expect(formatarHora(0)).toBe('00:00');
    expect(formatarHora(560)).toBe('09:20');
    expect(formatarHora(1439)).toBe('23:59');
  });

  it('08:00–09:20 = 1,33h (2 casas)', () => {
    expect(horasDecimais(80)).toBe('1,33h');
    expect(horasDecimais(60)).toBe('1,00h');
    expect(horasDecimais(90)).toBe('1,50h');
  });

  it('sobreposição: encostar pode; cruzar não', () => {
    expect(sobrepoe({ inicio: 480, fim: 560 }, { inicio: 560, fim: 600 })).toBe(false);
    expect(sobrepoe({ inicio: 480, fim: 560 }, { inicio: 420, fim: 480 })).toBe(false);
    expect(sobrepoe({ inicio: 480, fim: 560 }, { inicio: 540, fim: 600 })).toBe(true);
    expect(sobrepoe({ inicio: 480, fim: 560 }, { inicio: 500, fim: 520 })).toBe(true);
    expect(sobrepoe({ inicio: 480, fim: 560 }, { inicio: 400, fim: 700 })).toBe(true);
  });
});
