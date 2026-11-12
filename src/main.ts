import { config } from 'dotenv';
import * as path from 'path';
//o .env da pasta do backend, de onde quer que o servidor seja iniciado (RF-95)
config({ path: path.join(__dirname, '..', '.env') });
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { configurarCors } from './cors';
import { configurarProxy } from './proxy';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('TaskFlow API')
    .setDescription('Documentação da API do sistema de gestão TaskFlow')
    .setVersion('1.0')
    //.addBearerAuth()
    .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);

    //configurando o allexceptions filter para capturar todas as exceções e retornar um formato padronizado de erro
    app.useGlobalFilters(new AllExceptionsFilter());

  //só as origens do CORS_ORIGIN (RF-84)
  configurarCors(app);
  //IP do cliente atrás de proxy (RF-88)
  configurarProxy(app);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
