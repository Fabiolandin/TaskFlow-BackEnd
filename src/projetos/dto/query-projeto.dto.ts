import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { Transform, Type } from 'class-transformer'

// RF-12: paginação de GET /projetos e busca (RF-56). Valor inválido responde 400.
export class QueryProjetoDto {
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
    limit: number = 9

    // RF-56: espaços das pontas não contam; vazia equivale a sem busca (tratado no service)
    @IsOptional()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MaxLength(100)
    busca?: string
}
