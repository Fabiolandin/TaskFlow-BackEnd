import { ArrayUnique, IsArray, IsDate, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator"
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

    // RF-33: ids de labels existentes, sem repetição (a existência é conferida no service)
    @IsOptional()
    @IsArray()
    @IsInt({ each: true })
    @ArrayUnique()
    labelIds?: number[]
}
