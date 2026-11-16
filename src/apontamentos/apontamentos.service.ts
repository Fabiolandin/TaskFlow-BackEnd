import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import type { UsuarioAutenticado } from '../auth/usuario-atual.decorator';
import { paraData, paraTexto } from '../calendario/capacidade.logica';
import { SprintsService } from '../sprints/sprints.service';
import { formatarHora, lerHora, sobrepoe } from './horario.logica';
import type { CreateApontamentoDto, UpdateApontamentoDto } from './dto/apontamento.dto';

// SPEC-026: apontamento de horas (RF-128..RF-132)

const INCLUIR = {
  item: { select: { id: true, nome: true, tarefa: { select: { nome: true } }, sprint: { select: { id: true, nome: true, status: true } } } },
} as const satisfies Prisma.ApontamentosInclude;
type ApontamentoComItem = Prisma.ApontamentosGetPayload<{ include: typeof INCLUIR }>;

const SO_AS_SUAS = 'Você só aponta as suas horas';
const fechada = () => new HttpException('Sprint fechada', HttpStatus.CONFLICT);
const SEM_SPRINT = 'A data não está em nenhuma sprint';

const formatar = (a: ApontamentoComItem) => ({
  id: a.id,
  idUsuario: a.idUsuario,
  data: paraTexto(a.data),
  inicio: formatarHora(a.inicioMin),
  fim: formatarHora(a.fimMin),
  minutos: a.fimMin - a.inicioMin,
  idItemSprint: a.idItemSprint,
  item: a.item ? { id: a.item.id, nome: a.item.tarefa?.nome ?? a.item.nome, sprint: { id: a.item.sprint.id, nome: a.item.sprint.nome } } : null,
  observacao: a.observacao,
  foraDaSprint: a.foraDaSprint,
});

interface Dados {
  idUsuario: number;
  data: string;
  inicioMin: number;
  fimMin: number;
  idItemSprint: number | null;
  observacao: string | null;
  foraDaSprint: boolean;
}

@Injectable()
export class ApontamentosService {
  @Inject()
  private readonly prisma: PrismaService;

  @Inject()
  private readonly sprints: SprintsService;

  //RF-130: a sprint cujo período contém a data (no máximo uma, RF-109)
  private sprintDaData(data: string) {
    return this.prisma.sprints.findFirst({ where: { dataInicio: { lte: paraData(data) }, dataFim: { gte: paraData(data) } } });
  }

  //RF-129: o dev é o do token; admin pode indicar outro
  private dono(eu: UsuarioAutenticado, idUsuario?: number, mensagem = SO_AS_SUAS) {
    if (idUsuario !== undefined && idUsuario !== eu.id && !eu.isAdmin) throw new ForbiddenException(mensagem);
    return idUsuario ?? eu.id;
  }

  private async exigirDonoOuAdmin(eu: UsuarioAutenticado, id: number) {
    const atual = await this.prisma.apontamentos.findUniqueOrThrow({ where: { id }, include: INCLUIR });
    if (atual.idUsuario !== eu.id && !eu.isAdmin) throw new ForbiddenException(SO_AS_SUAS);
    if (atual.item?.sprint.status === 'Fechada') throw fechada();
    return atual;
  }

  //RF-128, RF-130: valida e devolve se o item é de outra sprint e o alerta de data fora de sprint
  private async validar(d: Dados, excetoId?: number) {
    if (d.fimMin <= d.inicioMin) throw new BadRequestException('A hora de fim precisa ser maior que a de início');
    if (d.idItemSprint === null && !d.observacao) throw new BadRequestException('Apontamento sem tarefa precisa de observação');
    const sprint = await this.sprintDaData(d.data);
    let foraDaSprint = false;
    if (d.idItemSprint !== null) {
      const item = await this.prisma.itensSprint.findUniqueOrThrow({ where: { id: d.idItemSprint }, include: { sprint: true } });
      if (item.idUsuario !== d.idUsuario) throw new BadRequestException('O item não é deste dev');
      if (item.sprint.status === 'Fechada') throw fechada();
      if (!sprint || item.idSprint !== sprint.id) {
        if (!d.foraDaSprint) throw new BadRequestException('O item não é da sprint desta data');
        foraDaSprint = true;
      }
    }
    const doDia = await this.prisma.apontamentos.findMany({
      where: { idUsuario: d.idUsuario, data: paraData(d.data), ...(excetoId && { id: { not: excetoId } }) },
      orderBy: { inicioMin: 'asc' },
    });
    const choque = doDia.find((o) => sobrepoe({ inicio: d.inicioMin, fim: d.fimMin }, { inicio: o.inicioMin, fim: o.fimMin }));
    if (choque) throw new HttpException(`O horário se sobrepõe ao apontamento das ${formatarHora(choque.inicioMin)} às ${formatarHora(choque.fimMin)}`, HttpStatus.CONFLICT);
    return { foraDaSprint, alerta: sprint ? undefined : SEM_SPRINT };
  }

  // ---------- leitura (RF-131) ----------

  async listar(eu: UsuarioAutenticado, data: string, idUsuario?: number) {
    const dono = this.dono(eu, idUsuario, 'Você só vê as suas horas');
    const [lista, sprint] = await Promise.all([
      this.prisma.apontamentos.findMany({ where: { idUsuario: dono, data: paraData(data) }, include: INCLUIR, orderBy: [{ inicioMin: 'asc' }, { id: 'asc' }] }),
      this.sprintDaData(data),
    ]);
    const ultimoFim = lista.reduce<number | null>((m, a) => (m === null || a.fimMin > m ? a.fimMin : m), null);
    return {
      data,
      sprint: sprint ? { id: sprint.id, nome: sprint.nome } : null,
      apontamentos: lista.map(formatar),
      totalMinutos: lista.reduce((s, a) => s + a.fimMin - a.inicioMin, 0),
      sugestaoInicio: ultimoFim === null ? null : formatarHora(ultimoFim),
    };
  }

  async itens(eu: UsuarioAutenticado, data: string, idUsuario?: number, todas = false) {
    const dono = this.dono(eu, idUsuario, 'Você só vê as suas horas');
    let where: Prisma.ItensSprintWhereInput;
    if (todas) {
      where = { idUsuario: dono, sprint: { status: { not: 'Fechada' } } };
    } else {
      const sprint = await this.sprintDaData(data);
      if (!sprint || sprint.status === 'Fechada') return [];
      where = { idUsuario: dono, idSprint: sprint.id };
    }
    const itens = await this.prisma.itensSprint.findMany({
      where,
      include: { tarefa: { select: { id: true, nome: true } }, sprint: { select: { id: true, nome: true, dataInicio: true } } },
      orderBy: [{ sprint: { dataInicio: 'asc' } }, { ordem: 'asc' }],
    });
    return itens.map((i) => ({ id: i.id, nome: i.tarefa?.nome ?? i.nome, idTarefa: i.tarefa?.id ?? null, sprint: { id: i.sprint.id, nome: i.sprint.nome } }));
  }

  // ---------- escrita ----------

  async criar(eu: UsuarioAutenticado, dto: CreateApontamentoDto) {
    const dados: Dados = {
      idUsuario: this.dono(eu, dto.idUsuario),
      data: dto.data,
      inicioMin: lerHora(dto.inicio)!,
      fimMin: lerHora(dto.fim)!,
      idItemSprint: dto.idItemSprint ?? null,
      observacao: dto.observacao?.trim() || null,
      foraDaSprint: dto.foraDaSprint ?? false,
    };
    const { foraDaSprint, alerta } = await this.validar(dados);
    const criado = await this.prisma.apontamentos.create({
      data: { idUsuario: dados.idUsuario, data: paraData(dados.data), inicioMin: dados.inicioMin, fimMin: dados.fimMin, idItemSprint: dados.idItemSprint, observacao: dados.observacao, foraDaSprint },
      include: INCLUIR,
    });
    return { ...formatar(criado), ...(alerta && { alerta }) };
  }

  async editar(eu: UsuarioAutenticado, id: number, dto: UpdateApontamentoDto) {
    const atual = await this.exigirDonoOuAdmin(eu, id);
    const dados: Dados = {
      idUsuario: atual.idUsuario,
      data: dto.data ?? paraTexto(atual.data),
      inicioMin: dto.inicio !== undefined ? lerHora(dto.inicio)! : atual.inicioMin,
      fimMin: dto.fim !== undefined ? lerHora(dto.fim)! : atual.fimMin,
      idItemSprint: dto.idItemSprint !== undefined ? dto.idItemSprint : atual.idItemSprint,
      observacao: dto.observacao !== undefined ? dto.observacao?.trim() || null : atual.observacao,
      foraDaSprint: dto.foraDaSprint ?? atual.foraDaSprint,
    };
    const { foraDaSprint, alerta } = await this.validar(dados, id);
    const editado = await this.prisma.apontamentos.update({
      where: { id },
      data: { data: paraData(dados.data), inicioMin: dados.inicioMin, fimMin: dados.fimMin, idItemSprint: dados.idItemSprint, observacao: dados.observacao, foraDaSprint },
      include: INCLUIR,
    });
    return { ...formatar(editado), ...(alerta && { alerta }) };
  }

  async excluir(eu: UsuarioAutenticado, id: number) {
    await this.exigirDonoOuAdmin(eu, id);
    return formatar(await this.prisma.apontamentos.delete({ where: { id }, include: INCLUIR }));
  }

  //RF-132: cria a tarefa, aloca na sprint da data e liga o apontamento, numa transação
  async converter(eu: UsuarioAutenticado, id: number, idProjeto: number) {
    const atual = await this.exigirDonoOuAdmin(eu, id);
    if (atual.idItemSprint !== null) throw new BadRequestException('Só apontamento sem tarefa pode ser convertido');
    const sprint = await this.sprintDaData(paraTexto(atual.data));
    if (!sprint) throw new HttpException(SEM_SPRINT, HttpStatus.CONFLICT);
    if (sprint.status === 'Fechada') throw fechada();
    await this.prisma.projetos.findUniqueOrThrow({ where: { id: idProjeto }, select: { id: true } });
    const primeiro = await this.prisma.statusTarefa.findFirstOrThrow({ orderBy: [{ ordem: 'asc' }, { id: 'asc' }] });

    const item = await this.prisma.$transaction(async (tx) => {
      const tarefa = await tx.tarefas.create({
        data: { nome: (atual.observacao ?? '').slice(0, 200), idStatus: primeiro.id, prioridade: 'Média', idProjeto, idUsuarioCriador: eu.id },
      });
      const novo = await this.sprints.alocarTarefaInterno(tx, sprint, tarefa.id, atual.idUsuario, eu.id);
      await tx.apontamentos.update({ where: { id }, data: { idItemSprint: novo.id, foraDaSprint: false } });
      return novo;
    });
    if (sprint.status === 'Ativa') await this.sprints.congelarComoProjetado(sprint, atual.idUsuario, item.id);
    return formatar(await this.prisma.apontamentos.findUniqueOrThrow({ where: { id }, include: INCLUIR }));
  }
}
