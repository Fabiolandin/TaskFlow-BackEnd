import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { ProjetosModule } from './projetos/projetos.module';
import { TarefasModule } from './tarefas/tarefas.module';
import { LabelsModule } from './labels/labels.module';

@Module({
  imports: [DatabaseModule, UsuariosModule, ProjetosModule, TarefasModule, LabelsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
