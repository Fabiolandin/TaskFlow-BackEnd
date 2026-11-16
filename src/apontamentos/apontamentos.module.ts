import { Module } from '@nestjs/common';
import { SprintsModule } from '../sprints/sprints.module';
import { ApontamentosController } from './apontamentos.controller';
import { ApontamentosService } from './apontamentos.service';

// SPEC-026: apontamento de horas; usa a alocação da sprint para "converter em tarefa não prevista"
@Module({
  imports: [SprintsModule],
  controllers: [ApontamentosController],
  providers: [ApontamentosService],
})
export class ApontamentosModule {}
