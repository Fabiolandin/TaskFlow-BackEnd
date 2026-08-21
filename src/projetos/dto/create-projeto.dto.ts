import { IsDate, IsNotEmpty, IsString } from "class-validator"

export class CreateProjetoDto {
    @IsNotEmpty()
    @IsString()
    nome: string

    @IsString()
    descricao?: string

    @IsNotEmpty()
    @IsString()
    status: number

    @IsDate()
    data_inicio?: Date

    @IsDate()
    data_final?: Date
}