import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Formato devolvido por JwtStrategy.validate, que o Passport coloca em req.user.
// isAdmin é lido do banco a cada pedido (RF-05, SPEC-021): promoção e rebaixamento valem na hora.
export interface UsuarioAutenticado {
    id: number;
    email: string;
    isAdmin: boolean;
}

// Lê o usuário autenticado (req.user) sem espalhar @Request() pelos controllers.
export const UsuarioAtual = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): UsuarioAutenticado =>
        ctx.switchToHttp().getRequest().user,
);
