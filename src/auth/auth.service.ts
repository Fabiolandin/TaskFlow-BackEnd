import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/database/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {

    @Inject()
    private readonly prisma: PrismaService

    @Inject()
    private readonly jwtService: JwtService

    async login(email: string, senha: string) {
        // Verifica se o usuário existe por email
        const usuarios = await this.prisma.usuarios.findUnique({ where: { email } });

        if (!usuarios) {
            throw new UnauthorizedException('Credenciais inválidas');
        }

        const senhaValida = await bcrypt.compare(senha, usuarios.senha);

        if (!senhaValida) {
            throw new UnauthorizedException('Credenciais inválidas');
        }

        const payload = {
            sub: usuarios.id,
            email: usuarios.email,
        };

        return {
            access_token: await this.jwtService.signAsync(payload),
        };
    }

}
