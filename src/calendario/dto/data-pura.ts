import { ValidateBy, type ValidationOptions } from 'class-validator';
import { dataValida } from '../capacidade.logica';

// Data "pura" AAAA-MM-DD que existe no calendário (2026-02-30 não passa). Gravada à meia-noite UTC.
export const IsDataPura = (opcoes?: ValidationOptions) =>
  ValidateBy({ name: 'isDataPura', validator: { validate: (v) => dataValida(v), defaultMessage: () => 'data AAAA-MM-DD inválida' } }, opcoes);
