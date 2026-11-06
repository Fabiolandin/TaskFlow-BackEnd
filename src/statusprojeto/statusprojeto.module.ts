import { Module } from '@nestjs/common';
import { StatusprojetoService } from './statusprojeto.service';
import { StatusprojetoController } from './statusprojeto.controller';

@Module({
  controllers: [StatusprojetoController],
  providers: [StatusprojetoService],
})
export class StatusprojetoModule {}
