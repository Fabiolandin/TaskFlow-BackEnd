import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { ProjetosModule } from './projetos/projetos.module';
import { TarefasModule } from './tarefas/tarefas.module';
import { LabelsModule } from './labels/labels.module';
import { ComentariostarefasModule } from './comentariostarefas/comentariostarefas.module';
import { APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from './validationSchemas/validation.pipe';

@Module({
  imports: [DatabaseModule, UsuariosModule, ProjetosModule, TarefasModule, LabelsModule, ComentariostarefasModule],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    }
  ],
})
export class AppModule {}
