import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateStatustarefaDto {
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
