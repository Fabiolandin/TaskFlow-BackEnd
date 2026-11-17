// RF-105 (SPEC-023): capacidade do dia e do período de um dev. Função pura, sem banco:
// recebe o calendário já lido e devolve os dias. Datas são "datas puras" no formato AAAA-MM-DD,
// tratadas em UTC (meia-noite UTC no banco, ponto 22 do tecnico.md); minutos são inteiros.

export interface JornadaCalc {
  vigencia: string;
  seg: number;
  ter: number;
  qua: number;
  qui: number;
  sex: number;
  sab: number;
  dom: number;
}

export interface FeriadoCalc {
  data: string;
  nome: string;
  //null = dia inteiro
  minutosDescontados: number | null;
}

export interface AusenciaCalc {
  tipo: string;
  dataInicio: string;
  dataFim: string;
  //null = dia inteiro
  minutosPorDia: number | null;
}

export interface Calendario {
  jornadas: JornadaCalc[];
  feriados: FeriadoCalc[];
  ausencias: AusenciaCalc[];
}

export interface DiaCapacidade {
  data: string;
  jornada: number;
  desconto: number;
  //"feriado: <nome>", "ausencia: <tipo>" ou null
  motivo: string | null;
  capacidade: number;
  util: boolean;
}

//getUTCDay: 0 = domingo
const DIAS: (keyof Omit<JornadaCalc, 'vigencia'>)[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const UM_DIA = 24 * 60 * 60 * 1000;

export const paraData = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);
export const paraTexto = (data: Date): string => data.toISOString().slice(0, 10);

//"hoje" = dia do relógio local do servidor (RF-148), não o dia UTC: com toISOString, depois das 21h em Brasília
//já seria amanhã. Gravado como data pura à meia-noite UTC (paraData), como as demais (ponto 29 do tecnico.md)
export const hojeLocal = (): string => {
  const d = new Date();
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
};

//data AAAA-MM-DD que existe no calendário (2026-02-30 não passa)
export const dataValida = (texto: unknown): texto is string =>
  typeof texto === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(texto) && !Number.isNaN(paraData(texto).getTime()) && paraTexto(paraData(texto)) === texto;

//quantidade de dias de inicio a fim, inclusive
export const diasNoPeriodo = (inicio: string, fim: string): number =>
  Math.round((paraData(fim).getTime() - paraData(inicio).getTime()) / UM_DIA) + 1;

//jornada vigente: a de maior vigência <= data (comparação de texto AAAA-MM-DD equivale à de datas)
const jornadaDoDia = (jornadas: JornadaCalc[], data: string): number => {
  let vigente: JornadaCalc | undefined;
  for (const j of jornadas) {
    if (j.vigencia <= data && (!vigente || j.vigencia > vigente.vigencia)) vigente = j;
  }
  return vigente ? vigente[DIAS[paraData(data).getUTCDay()]] : 0;
};

const calcularDia = (cal: Calendario, data: string): DiaCapacidade => {
  const jornada = jornadaDoDia(cal.jornadas, data);

  const feriado = cal.feriados.find((f) => f.data === data);
  const descontoFeriado = feriado ? Math.min(feriado.minutosDescontados ?? jornada, jornada) : 0;

  //ausências sobrepostas: vale a de maior desconto (empate: a primeira)
  let ausencia: AusenciaCalc | undefined;
  let descontoAusencia = 0;
  for (const a of cal.ausencias) {
    if (a.dataInicio > data || a.dataFim < data) continue;
    const d = Math.min(a.minutosPorDia ?? jornada, jornada);
    if (!ausencia || d > descontoAusencia) {
      ausencia = a;
      descontoAusencia = d;
    }
  }

  //feriado e ausência no mesmo dia não somam: vale o maior; empate fica com o feriado
  let desconto = 0;
  let motivo: string | null = null;
  if (feriado && descontoFeriado >= descontoAusencia) {
    desconto = descontoFeriado;
    motivo = `feriado: ${feriado.nome}`;
  } else if (ausencia) {
    desconto = descontoAusencia;
    motivo = `ausencia: ${ausencia.tipo}`;
  }

  const capacidade = Math.max(0, jornada - desconto);
  return { data, jornada, desconto, motivo, capacidade, util: capacidade > 0 };
};

//um DiaCapacidade por dia, de inicio a fim inclusive (inicio > fim devolve vazio)
export const capacidadeDosDias = (inicio: string, fim: string, cal: Calendario): DiaCapacidade[] => {
  const dias: DiaCapacidade[] = [];
  for (let t = paraData(inicio).getTime(); t <= paraData(fim).getTime(); t += UM_DIA) {
    dias.push(calcularDia(cal, paraTexto(new Date(t))));
  }
  return dias;
};

export const capacidadeTotal = (dias: DiaCapacidade[]): number => dias.reduce((soma, d) => soma + d.capacidade, 0);
