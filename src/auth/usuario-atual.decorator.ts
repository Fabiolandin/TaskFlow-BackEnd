import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Formato devolvido por JwtStrategy.validate, que o Passport coloca em req.user.
export interface UsuarioAutenticado {
    id: number;
    email: string;
}

// Lê o usuário autenticado (req.user) sem espalhar @Request() pelos controllers.
export const UsuarioAtual = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): UsuarioAutenticado =>
        ctx.switchToHttp().getRequest().user,
);
