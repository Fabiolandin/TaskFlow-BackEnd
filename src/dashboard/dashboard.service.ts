import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { hojeLocal } from 'src/calendario/capacidade.logica';


@Injectable()
export class DashboardService {
  @Inject()
  private readonly prisma: PrismaService;

  async obter() {
    // `data_final` é lida em UTC (como o front exibe): o dia UTC anterior a hoje é o mesmo
    // que o instante anterior à meia-noite UTC do dia de hoje. Sem data_final, a comparação é falsa.
    const inicioDeHoje = new Date(`${hojeLocal()}T00:00:00.000Z`);

    const [status, porStatusContagem, projetos, porProjetoContagem, atrasadas] = await Promise.all([
      this.prisma.statusTarefa.findMany({ orderBy: [{ ordem: 'asc' }, { id: 'asc' }] }),
      this.prisma.tarefas.groupBy({ by: ['idStatus'], _count: { _all: true } }),
      this.prisma.projetos.findMany({ select: { id: true, nome: true } }),
      this.prisma.tarefas.groupBy({ by: ['idProjeto'], _count: { _all: true } }),
      this.prisma.tarefas.count({
        where: { status: { isFinal: false }, data_final: { lt: inicioDeHoje } },
      }),
    ]);

    const totalDoStatus = new Map(porStatusContagem.map((g) => [g.idStatus, g._count._all]));
    const totalDoProjeto = new Map(porProjetoContagem.map((g) => [g.idProjeto, g._count._all]));

    const porStatus = status.map((s) => ({
      id: s.id,
      nome: s.nome,
      cor: s.cor,
      isFinal: s.isFinal,
      total: totalDoStatus.get(s.id) ?? 0,
    }));
    const porProjeto = projetos
      .map((p) => ({ id: p.id, nome: p.nome, total: totalDoProjeto.get(p.id) ?? 0 }))
      .sort((a, b) => b.total - a.total || a.id - b.id);

    const total = porStatus.reduce((soma, s) => soma + s.total, 0);
    const concluidas = porStatus.filter((s) => s.isFinal).reduce((soma, s) => soma + s.total, 0);

    return {
      tarefas: { total, abertas: total - concluidas, concluidas, atrasadas, porStatus, porProjeto },
    };
  }
}
