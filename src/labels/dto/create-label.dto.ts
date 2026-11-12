import { Transform } from "class-transformer";
import { IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

export class CreateLabelDto {
    @IsNotEmpty()
    @IsString()
    nome: string;

    //opcional; quando vem, é #RRGGBB. "" vira null (sem cor), como ausente ou null (RF-76, mesma regra do RF-21)
    @Transform(({ value }) => (value === "" ? null : value))
    @IsOptional()
    @IsString()
    @Matches(/^#[0-9A-Fa-f]{6}$/)
    cor?: string | null;
}
