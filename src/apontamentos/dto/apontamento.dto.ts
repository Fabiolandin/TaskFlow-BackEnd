import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDataPura } from '../../calendario/dto/data-pura';

// RF-128 (SPEC-026): HH:MM de 00:00 a 23:59
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateApontamentoDto {
  @IsDataPura()
  data: string;

  @Matches(HORA)
  inicio: string;

  @Matches(HORA)
  fim: string;

  //null ou ausente = sem tarefa (exige observação)
  @IsOptional()
  @IsInt()
  idItemSprint?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string | null;

  //RF-130: item de outra sprint que não a da data
  @IsOptional()
  @IsBoolean()
  foraDaSprint?: boolean;

  //RF-129: só admin lança para outro
  @IsOptional()
  @IsInt()
  idUsuario?: number;
}

export class UpdateApontamentoDto extends PartialType(OmitType(CreateApontamentoDto, ['idUsuario'] as const)) {}

export class QueryApontamentosDto {
  @IsDataPura()
  data: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  idUsuario?: number;
}

export class QueryItensApontaveisDto extends QueryApontamentosDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  todas?: boolean;
}

// RF-132
export class ConverterApontamentoDto {
  @IsInt()
  idProjeto: number;
}
