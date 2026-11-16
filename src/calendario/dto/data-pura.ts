import { ValidateBy, type ValidationOptions } from 'class-validator';
import { dataValida } from '../capacidade.logica';

//limites de data aceitos pela API (evita anos como 202222)
export const DATA_MIN = new Date('2000-01-01T00:00:00Z');
export const DATA_MAX = new Date('2099-12-31T23:59:59Z');

// Data "pura" AAAA-MM-DD que existe no calendário (2026-02-30 não passa), entre 2000 e 2099. Gravada à meia-noite UTC.
export const IsDataPura = (opcoes?: ValidationOptions) =>
  ValidateBy({ name: 'isDataPura', validator: { validate: (v) => dataValida(v) && v >= '2000-01-01' && v <= '2099-12-31', defaultMessage: () => 'data AAAA-MM-DD inválida (entre 2000 e 2099)' } }, opcoes);
