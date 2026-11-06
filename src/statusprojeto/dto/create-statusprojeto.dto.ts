import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateStatusprojetoDto {
    @IsNotEmpty()
    @IsString()
    nome: string;

    @IsOptional()
    @IsString()
    cor?: string;

    @IsInt()
    ordem: number;

    @IsOptional()
    @IsBoolean()
    isFinal?: boolean;
}
