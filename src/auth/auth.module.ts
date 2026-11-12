import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { ThrottlerModule } from '@nestjs/throttler';
import { LIMITE_LOGIN, LoginThrottlerGuard } from './login-throttler.guard';

@Module({
    imports: [
        PassportModule,
        //só o login usa o limitador (RF-85); as outras rotas não passam pelo guard dele
        ThrottlerModule.forRoot([LIMITE_LOGIN]),
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: '1d' },
        }),
    ],
    providers: [AuthService, JwtStrategy, LoginThrottlerGuard],
    controllers: [AuthController]
})
export class AuthModule { }
