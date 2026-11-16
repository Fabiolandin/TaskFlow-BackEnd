import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';
import { IsDataPura } from '../../calendario/dto/data-pura';

// RF-109 (SPEC-024)
export class CreateSprintDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nome: string;

  @IsDataPura()
  dataInicio: string;

  @IsDataPura()
  dataFim: string;
}

export class UpdateSprintDto extends PartialType(CreateSprintDto) {}

// RF-110: item de tarefa ({ idTarefa }) ou avulso ({ nome, minutosAvulsos, recorrente }); o service confere o tipo
export class CreateItemDto {
  @IsInt()
  idUsuario: number;

  @IsOptional()
  @IsInt()
  idTarefa?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nome?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  minutosAvulsos?: number;

  @IsOptional()
  @IsBoolean()
  recorrente?: boolean;

  //1 = topo da fila; ausente = fim
  @IsOptional()
  @IsInt()
  @Min(1)
  posicao?: number;
}

export class UpdateItemDto {
  @IsOptional()
  @IsInt()
  idUsuario?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  posicao?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nome?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  minutosAvulsos?: number;

  @IsOptional()
  @IsBoolean()
  recorrente?: boolean;
}

export class ReordenarFilaDto {
  @IsArray()
  @IsInt({ each: true })
  @ArrayUnique()
  ids: number[];
}

// RF-120 (SPEC-025): acompanhamento do item; vazio ou null limpa os textos
export class AcompanhamentoDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  evolucao?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bloqueio?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string | null;

  @IsOptional()
  @IsDataPura()
  dataEntregaReal?: string | null;
}

// RF-126
export class QueryCronogramaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  idProjeto?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  idUsuario?: number;
}

// RF-137 (SPEC-027): destino de cada tarefa não concluída
export class ItemFechamentoDto {
  @IsInt()
  id: number;

  @IsIn(['proxima', 'backlog'])
  destino: 'proxima' | 'backlog';
}

export class FecharSprintDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemFechamentoDto)
  itens: ItemFechamentoDto[];
}
