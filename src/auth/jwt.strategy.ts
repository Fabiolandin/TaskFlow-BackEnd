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

    // RF-05 (SPEC-021): o usuário do token precisa existir; o papel vem do banco, não do token
    async validate(payload: { sub: number; email: string }): Promise<UsuarioAutenticado> {
        const usuario = await this.prisma.usuarios.findUnique({
            where: { id: Number(payload.sub) },
            select: { id: true, email: true, isAdmin: true },
        });
        if (!usuario) throw new UnauthorizedException('Usuário não encontrado');
        return usuario;
    }
}
