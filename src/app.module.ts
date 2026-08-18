import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { ProjetosModule } from './projetos/projetos.module';

@Module({
  imports: [DatabaseModule, UsuariosModule, ProjetosModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
