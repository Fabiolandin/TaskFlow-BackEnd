import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDataPura } from './data-pura';

// RF-104
export const TIPOS_AUSENCIA = ['Ferias', 'Folga', 'Atestado', 'Outro'] as const;

export class CreateAusenciaDto {
  @IsInt()
  idUsuario: number;

  @IsIn(TIPOS_AUSENCIA)
  tipo: (typeof TIPOS_AUSENCIA)[number];

  @IsDataPura()
  dataInicio: string;

  @IsDataPura()
  dataFim: string;

  //ausente/null = dia inteiro
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  minutosPorDia?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string | null;
}

export class UpdateAusenciaDto extends PartialType(OmitType(CreateAusenciaDto, ['idUsuario'] as const)) {}

export class QueryAusenciasDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  idUsuario?: number;

  @IsOptional()
  @IsDataPura()
  inicio?: string;

  @IsOptional()
  @IsDataPura()
  fim?: string;
}
