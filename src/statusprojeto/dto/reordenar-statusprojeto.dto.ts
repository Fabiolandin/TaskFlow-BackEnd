import { ArrayUnique, IsArray, IsInt } from "class-validator";

//RF-62: todos os ids do cadastro, sem repetição, na ordem desejada (a completude é conferida no service)
export class ReordenarStatusprojetoDto {
    @IsArray()
    @IsInt({ each: true })
    @ArrayUnique()
    ids: number[];
}
