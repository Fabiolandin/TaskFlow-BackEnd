import { Transform } from "class-transformer";
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

export class CreateStatusprojetoDto {
    @IsNotEmpty()
    @IsString()
    nome: string;

    //opcional; quando vem, é #RRGGBB. "" vira null (sem cor), como ausente ou null (RF-21, SPEC-014)
    @Transform(({ value }) => (value === "" ? null : value))
    @IsOptional()
    @IsString()
    @Matches(/^#[0-9A-Fa-f]{6}$/)
    cor?: string | null;

    @IsInt()
    ordem: number;

    @IsOptional()
    @IsBoolean()
    isFinal?: boolean;
}
