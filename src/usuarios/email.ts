import { Transform } from 'class-transformer';

//email sem espaços nas pontas e em minúsculas (RF-83); valor que não é texto passa como está para o validador
export const normalizarEmail = (valor: unknown) => (typeof valor === 'string' ? valor.trim().toLowerCase() : valor);
export const EmailNormalizado = () => Transform(({ value }) => normalizarEmail(value));
