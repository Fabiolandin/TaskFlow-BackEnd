import { ArrayUnique, IsArray, IsDate, IsInt, IsNotEmpty, IsOptional, IsString, MaxDate, MinDate } from "class-validator"
import { Type } from "class-transformer"
import { DATA_MAX, DATA_MIN } from "../../calendario/dto/data-pura"

export class CreateProjetoDto {
    @IsNotEmpty()
    @IsString()
    nome: string

    @IsOptional()
    @IsString()
    descricao?: string

    @IsNotEmpty()
    @IsInt()
    idStatus: number

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    @MinDate(DATA_MIN, { message: 'data deve ser a partir de 2000' })
    @MaxDate(DATA_MAX, { message: 'data deve ser até 2099' })
    data_inicio?: Date

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    @MinDate(DATA_MIN, { message: 'data deve ser a partir de 2000' })
    @MaxDate(DATA_MAX, { message: 'data deve ser até 2099' })
    data_final?: Date

    //ids dos usuários que entram como membros, gravados junto com o projeto (RF-28)
    @IsOptional()
    @IsArray()
    @IsInt({ each: true })
    @ArrayUnique()
    membros?: number[]
}
