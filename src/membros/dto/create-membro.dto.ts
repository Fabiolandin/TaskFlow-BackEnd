import { IsInt } from "class-validator";

export class CreateMembroDto {
    @IsInt()
    idUsuario: number;
}
