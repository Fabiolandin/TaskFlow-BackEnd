import { ArrayUnique, IsArray, IsDate, IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator"
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
    idStatus: number

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    data_inicio?: Date

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    data_final?: Date

    //ids dos usuários que entram como membros, gravados junto com o projeto (RF-28)
    @IsOptional()
    @IsArray()
    @IsInt({ each: true })
    @ArrayUnique()
    membros?: number[]
}
