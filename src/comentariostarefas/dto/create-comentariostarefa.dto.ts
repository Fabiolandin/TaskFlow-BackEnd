import { IsNotEmpty, IsNumber, IsString } from "class-validator"

export class CreateComentariostarefaDto {
    @IsNotEmpty()
    @IsString()
    comentario: string

    @IsNotEmpty()
    @IsNumber()
    idTarefa: number

    @IsNotEmpty()
    @IsNumber()
    idUsuario: number

    @IsNotEmpty()
    createdAt: Date

    @IsNotEmpty()
    updatedAt: Date
}
