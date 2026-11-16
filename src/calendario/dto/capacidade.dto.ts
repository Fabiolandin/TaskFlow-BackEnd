import { IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { IsDataPura } from './data-pura';

// RF-106: os três obrigatórios
export class QueryCapacidadeDto {
  @Type(() => Number)
  @IsInt()
  idUsuario: number;

  @IsDataPura()
  inicio: string;

  @IsDataPura()
  fim: string;
}

// RF-101: sem idUsuario, todas as jornadas
export class QueryJornadasDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  idUsuario?: number;
}
