import { IsNotEmpty, IsString } from 'class-validator'

// RF-36: o PATCH só altera o texto. idTarefa e idUsuario não existem aqui: o whitelist os descarta.
export class UpdateComentariostarefaDto {
    @IsNotEmpty()
    @IsString()
    comentario: string
}
