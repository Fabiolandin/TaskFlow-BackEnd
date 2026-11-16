import { ArrayUnique, IsArray, IsDate, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator"
import { Type } from "class-transformer"

// RF-22: conjunto fixo, não cadastro.
export const PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Urgente'] as const
export type Prioridade = typeof PRIORIDADES[number]

export class CreateTarefaDto {

    @IsNotEmpty()
    @IsString()
    nome: string

    @IsOptional()
    @IsString()
    descricao?: string

    @IsNotEmpty()
    @IsNumber()
    idStatus: number

    @IsIn(PRIORIDADES)
    prioridade: Prioridade

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    data_inicio?: Date

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    data_final?: Date

    @IsOptional()
    @IsNumber()
    idUsuarioResponsavel?: number

    @IsNotEmpty()
    @IsNumber()
    idProjeto: number

    // RF-65: tarefa-pai, só na criação (o PATCH não aceita); existência e projeto conferidos no service
    @IsOptional()
    @IsInt()
    idTarefaPai?: number

    // RF-33: ids de labels existentes, sem repetição (a existência é conferida no service)
    @IsOptional()
    @IsArray()
    @IsInt({ each: true })
    @ArrayUnique()
    labelIds?: number[]

    // RF-108 (SPEC-024): refinamento, todos opcionais; horas em minutos inteiros; null limpa
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(100000)
    minutosEstimados?: number | null

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(100000)
    minutosBuffer?: number | null

    @IsOptional()
    @IsString()
    @MaxLength(50)
    issueExterna?: string | null

    @IsOptional()
    @IsString()
    @MaxLength(100)
    solicitante?: string | null
}
