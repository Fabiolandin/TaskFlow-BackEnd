import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';
import { normalizarEmail } from '../usuarios/email';

export const LIMITE_LOGIN = { name: 'login', ttl: 60_000, limit: 5 };

//limite de tentativas de login (RF-85): 5 por minuto para a mesma combinação de IP e email.
//O guard roda antes do pipe e do serviço: a 6ª tentativa nem verifica a senha.
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
    protected async getTracker(req: Record<string, any>): Promise<string> {
        const email = normalizarEmail(req.body?.email);
        return `${req.ip}|${typeof email === 'string' ? email : ''}`;
    }

    protected async throwThrottlingException(_context: ExecutionContext): Promise<void> {
        throw new ThrottlerException('Muitas tentativas de login. Tente de novo em 1 minuto.');
    }
}
