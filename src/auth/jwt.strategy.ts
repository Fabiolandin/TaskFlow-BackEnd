import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../database/prisma.service';
import type { UsuarioAutenticado } from './usuario-atual.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private readonly prisma: PrismaService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_SECRET as string,
        });
    }

    // RF-05 (SPEC-021): o usuário do token precisa existir; o papel vem do banco, não do token.
    // RF-92 (SPEC-022): o token carrega a versão da senha (sa); se a senha mudou depois, ele cai.
    // Token sem sa (emitido antes da SPEC-022) vale enquanto a senha nunca foi trocada
    async validate(payload: { sub: number; email: string; sa?: number | null }): Promise<UsuarioAutenticado> {
        const usuario = await this.prisma.usuarios.findUnique({
            where: { id: Number(payload.sub) },
            select: { id: true, email: true, isAdmin: true, senhaAlteradaEm: true },
        });
        if (!usuario) throw new UnauthorizedException('Usuário não encontrado');
        const versao = usuario.senhaAlteradaEm ? usuario.senhaAlteradaEm.getTime() : null;
        if ((payload.sa ?? null) !== versao) throw new UnauthorizedException('Sessão encerrada: a senha foi alterada');
        return { id: usuario.id, email: usuario.email, isAdmin: usuario.isAdmin };
    }
}
