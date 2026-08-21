import { IsDate, IsNotEmpty, IsNumber, IsString } from "class-validator"

export class CreateTarefaDto {

    @IsNotEmpty()
    @IsString()
    nome: string

    @IsString()
    descricao: string

    @IsNotEmpty()
    @IsNumber()
    status: number

    @IsNotEmpty()
    @IsString()
    prioridade: string

    @IsDate()
    data_inicio?: Date

    @IsDate()
    data_final?: Date

    @IsNumber()
    idUsuarioResponsavel: number

    @IsNotEmpty()
    @IsNumber()
    idUsuarioCriador: number

    @IsNotEmpty()
    @IsNumber()
    idProjeto: number

    @IsDate()
    createdAt: Date

    @IsDate()
    updatedAt: Date

    labelIds?: number[]
}
