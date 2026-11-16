import { Module } from '@nestjs/common';
import { CalendarioService } from './calendario.service';
import { AusenciasController, CapacidadeController, FeriadosController, JornadasController } from './calendario.controller';
import { CLIENTE_FERIADOS, ClienteBrasilApi } from './cliente-feriados';

// SPEC-023: calendário do time e capacidade. O service é exportado para a fila da SPEC-024.
@Module({
  controllers: [JornadasController, FeriadosController, AusenciasController, CapacidadeController],
  providers: [CalendarioService, { provide: CLIENTE_FERIADOS, useClass: ClienteBrasilApi }],
  exports: [CalendarioService],
})
export class CalendarioModule {}
