import { IsDate, IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator"
import { Type } from "class-transformer"

export class CreateProjetoDto {
    @IsNotEmpty()
    @IsString()
    nome: string

    @IsOptional()
    @IsString()
    descricao?: string

    @IsNotEmpty()
    @IsInt()
    status: number

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    data_inicio?: Date

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    data_final?: Date
}