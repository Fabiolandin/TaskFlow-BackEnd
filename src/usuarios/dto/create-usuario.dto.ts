import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator"
import { EmailNormalizado } from "../email"

export class CreateUsuarioDto {
    @IsNotEmpty()
    @IsString()
    nome: string

    //formato válido, gravado sem espaços e em minúsculas (RF-83)
    @EmailNormalizado()
    @IsNotEmpty()
    @IsEmail()
    email: string

    @IsNotEmpty()
    @IsString()
    senha: string

    //só admin cria ou altera o papel (RF-81, RF-82); ausente, nasce comum
    @IsOptional()
    @IsBoolean()
    isAdmin?: boolean
}
