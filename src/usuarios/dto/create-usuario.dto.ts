import { IsNotEmpty, IsString } from "class-validator"

export class CreateUsuarioDto {
    @IsNotEmpty()
    @IsString()
    nome: string

    @IsNotEmpty()
    @IsString()
    email: string

    @IsNotEmpty()
    @IsString()
    senha: string
}
