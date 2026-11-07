import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Números gerais das tarefas (total, abertas, concluídas, atrasadas, por status e por projeto)' })
  obter() {
    return this.dashboardService.obter();
  }
}
