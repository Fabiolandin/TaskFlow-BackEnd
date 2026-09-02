import { IsDate, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator"
import { Type } from "class-transformer"

export class CreateTarefaDto {

    @IsNotEmpty()
    @IsString()
    nome: string

    @IsOptional()
    @IsString()
    descricao?: string

    @IsNotEmpty()
    @IsNumber()
    status: number

    @IsNotEmpty()
    @IsString()
    prioridade: string

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
    idUsuarioCriador: number

    @IsNotEmpty()
    @IsNumber()
    idProjeto: number

    labelIds?: number[]
}
