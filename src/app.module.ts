import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [DatabaseModule, UsuariosModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
