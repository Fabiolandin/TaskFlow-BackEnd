import { IsNotEmpty, IsNumber, IsString } from "class-validator"

export class CreateComentariostarefaDto {
    @IsNotEmpty()
    @IsString()
    comentario: string

    @IsNotEmpty()
    @IsNumber()
    idTarefa: number
}
