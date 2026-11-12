import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';
import { Public } from './public.decorator';
import { LoginThrottlerGuard } from './login-throttler.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Public()
    @UseGuards(LoginThrottlerGuard)
    @Post('login')
    @ApiOperation({ summary: 'Autenticar usuário e obter token JWT' })
    login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto.email, loginDto.senha);
    }
}
