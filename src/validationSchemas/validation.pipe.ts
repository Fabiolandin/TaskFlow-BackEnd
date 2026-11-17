import {
    PipeTransform,
    Injectable,
    ArgumentMetadata,
    BadRequestException,
} from '@nestjs/common';
import { validate, type ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';

//caminho de cada campo inválido, inclusive dentro de objetos (ex.: "itens.0.nome")
const campos = (erros: ValidationError[], prefixo = ''): string[] =>
    erros.flatMap((e) => {
        const caminho = `${prefixo}${e.property}`;
        return e.children?.length ? campos(e.children, `${caminho}.`) : [caminho];
    });

@Injectable()
export class ValidationPipe implements PipeTransform {
    async transform(value: any, { metatype }: ArgumentMetadata) {
        if (!metatype || !this.toValidate(metatype)) {
            return value;
        }
        const object = plainToInstance(metatype, value);
        const errors = await validate(object, { whitelist: true});
        if (errors.length > 0) {
            //diz quais campos falharam (ex.: "Dados inválidos: nome, idStatus"), em vez de um texto genérico
            throw new BadRequestException(`Dados inválidos: ${campos(errors).join(', ')}`);
        }
        return object;
    }

    private toValidate(metatype: Function): boolean {
        const types: Function[] = [String, Boolean, Number, Array, Object];
        return !types.includes(metatype);
    }
}