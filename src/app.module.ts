import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { ProjetosModule } from './projetos/projetos.module';
import { TarefasModule } from './tarefas/tarefas.module';
import { LabelsModule } from './labels/labels.module';
import { ComentariostarefasModule } from './comentariostarefas/comentariostarefas.module';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from './validationSchemas/validation.pipe';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Module({
  imports: [DatabaseModule, UsuariosModule, ProjetosModule, TarefasModule, LabelsModule, ComentariostarefasModule, AuthModule],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    }
  ],
})
export class AppModule { }
