import { Module } from '@nestjs/common';
import { ComentariostarefasService } from './comentariostarefas.service';
import { ComentariostarefasController } from './comentariostarefas.controller';

@Module({
  controllers: [ComentariostarefasController],
  providers: [ComentariostarefasService],
})
export class ComentariostarefasModule {}
