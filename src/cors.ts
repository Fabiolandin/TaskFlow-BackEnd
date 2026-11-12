import { INestApplication } from '@nestjs/common';

//origens do navegador que podem chamar a API (RF-84): CORS_ORIGIN no .env, separadas por vírgula
export const origensPermitidas = () =>
  (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

//pedido de origem fora da lista não recebe Access-Control-Allow-Origin
export const configurarCors = (app: INestApplication) => {
  app.enableCors({ origin: origensPermitidas() });
};
