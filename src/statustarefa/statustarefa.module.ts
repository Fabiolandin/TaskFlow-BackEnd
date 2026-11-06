import { Module } from '@nestjs/common';
import { StatustarefaService } from './statustarefa.service';
import { StatustarefaController } from './statustarefa.controller';

@Module({
  controllers: [StatustarefaController],
  providers: [StatustarefaService],
})
export class StatustarefaModule {}
