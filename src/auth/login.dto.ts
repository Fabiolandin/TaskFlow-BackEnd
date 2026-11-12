import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";
import { EmailNormalizado } from "../usuarios/email";

export class LoginDto {
    //o mesmo email do cadastro: sem espaços e em minúsculas (RF-83)
    @EmailNormalizado()
    @IsEmail()
    @IsNotEmpty()
    @ApiProperty({ example: 'funcionario@taskflow.com' })
    email: string

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ example: 'senha123' })
    senha: string
}