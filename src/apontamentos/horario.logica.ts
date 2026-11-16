// RF-128 (SPEC-026): horários do apontamento. Funções puras; horas guardadas como minutos do dia (0..1439).

const FORMATO = /^([01]\d|2[0-3]):([0-5]\d)$/;

//"HH:MM" de 00:00 a 23:59 → minutos; qualquer outra coisa → null
export const lerHora = (texto: unknown): number | null => {
  if (typeof texto !== 'string') return null;
  const m = texto.match(FORMATO);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export const formatarHora = (minutos: number): string =>
  `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;

//80 → "1,33h" (2 casas, vírgula), como a planilha
export const horasDecimais = (minutos: number): string => `${(minutos / 60).toFixed(2).replace('.', ',')}h`;

//intervalos [inicio, fim): encostar (fim de um = início do outro) não é sobrepor
export const sobrepoe = (a: { inicio: number; fim: number }, b: { inicio: number; fim: number }): boolean =>
  a.inicio < b.fim && b.inicio < a.fim;
