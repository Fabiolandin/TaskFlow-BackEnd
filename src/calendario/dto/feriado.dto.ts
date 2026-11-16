import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDataPura } from './data-pura';

// RF-102: minutosDescontados ausente/null = dia inteiro; com valor, meio período (1..1440)
export class CreateFeriadoDto {
  @IsDataPura()
  data: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  minutosDescontados?: number | null;
}

export class UpdateFeriadoDto extends PartialType(CreateFeriadoDto) {}

// RF-103
export class ImportarFeriadosDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  ano: number;
}

export class QueryFeriadosDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  ano?: number;
}
