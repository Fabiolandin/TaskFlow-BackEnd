import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { EmailNormalizado } from '../email';

//campo ausente = não muda; null não é "ausente" e responde 400 (RF-94).
//Por isso não usa o PartialType (o @IsOptional dele deixa o null passar)
const SeVeio = () => ValidateIf((_, valor) => valor !== undefined);

export class UpdateUsuarioDto {
    @ApiPropertyOptional()
    @SeVeio()
    @IsNotEmpty()
    @IsString()
    nome?: string

    //formato válido, gravado sem espaços e em minúsculas (RF-83)
    @ApiPropertyOptional()
    @EmailNormalizado()
    @SeVeio()
    @IsNotEmpty()
    @IsEmail()
    email?: string

    @ApiPropertyOptional()
    @SeVeio()
    @IsNotEmpty()
    @IsString()
    senha?: string

    //obrigatória para trocar a senha da própria conta (RF-93); nunca é gravada
    @ApiPropertyOptional()
    @SeVeio()
    @IsNotEmpty()
    @IsString()
    senhaAtual?: string

    //só admin altera o papel (RF-82)
    @ApiPropertyOptional()
    @SeVeio()
    @IsBoolean()
    isAdmin?: boolean
}
