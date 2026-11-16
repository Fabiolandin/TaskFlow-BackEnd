import { Module } from '@nestjs/common';
import { CalendarioModule } from '../calendario/calendario.module';
import { ItensController, SprintsController } from './sprints.controller';
import { SprintsService } from './sprints.service';

// SPEC-024: sprint, itens, fila e planejamento. Usa a capacidade do calendário (SPEC-023).
@Module({
  imports: [CalendarioModule],
  controllers: [SprintsController, ItensController],
  providers: [SprintsService],
  exports: [SprintsService],
})
export class SprintsModule {}
