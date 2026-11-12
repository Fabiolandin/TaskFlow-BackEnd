import { INestApplication } from '@nestjs/common';

//quantos proxies há na frente da API (RF-88): TRUST_PROXY no .env; ausente ou 0 = nenhum.
//Com proxy, o req.ip passa a ser o do cliente (X-Forwarded-For); sem, o cabeçalho é ignorado e ninguém forja o IP
export const saltosDeProxy = () => {
  const n = Number.parseInt(process.env.TRUST_PROXY ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const configurarProxy = (app: INestApplication) => {
  app.getHttpAdapter().getInstance().set('trust proxy', saltosDeProxy());
};
