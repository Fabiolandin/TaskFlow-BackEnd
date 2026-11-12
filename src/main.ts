import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { configurarCors } from './cors';

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
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
