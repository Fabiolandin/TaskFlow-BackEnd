import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { Transform, Type } from 'class-transformer'

// RF-31: paginação e filtros de GET /tarefas. Tudo inteiro; valor inválido responde 400.
export class QueryTarefaDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit: number = 10

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    idProjeto?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    idStatus?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    idUsuarioResponsavel?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    idUsuarioCriador?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    idLabel?: number

    // RF-31/RF-65: só as sub-tarefas diretas desta tarefa
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    idTarefaPai?: number

    // RF-38: responsável OU criador; combina com E com os demais filtros.
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    idUsuarioEnvolvido?: number

    // RF-56: nome contém o texto; espaços das pontas não contam; vazia equivale a sem busca
    @IsOptional()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MaxLength(100)
    busca?: string
}
