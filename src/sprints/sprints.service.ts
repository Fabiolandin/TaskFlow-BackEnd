import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { SELECT_MEMBRO } from 'src/membros/membros.service';
import { SELECT_TAREFA, diferencas, formatarTarefa } from 'src/tarefas/tarefas.service';
import type { UsuarioAutenticado } from '../auth/usuario-atual.decorator';
import { CalendarioService } from '../calendario/calendario.service';
import { capacidadeDosDias, capacidadeTotal, paraData, paraTexto } from '../calendario/capacidade.logica';
import { calcularFila, type PosicaoNaFila } from './fila.logica';
import { desligarApontamentos } from '../apontamentos/desligar';
import { atrasoDoItem, consumoDoItem, diasUteisNoPeriodo, evolucaoPonderada, restantesDoItem, riscoDoItem, statusDoItem } from './acompanhamento.logica';
import type { AcompanhamentoDto, CreateItemDto, CreateSprintDto, FecharSprintDto, QueryCronogramaDto, UpdateItemDto, UpdateSprintDto } from './dto/sprint.dto';

// SPEC-024: sprint do time (RF-109), itens (RF-110, RF-111), horas (RF-112), fila (RF-113, RF-114),
// ocupação (RF-115), transbordo (RF-118) e recorrentes (RF-119)

type Tx = Prisma.TransactionClient;
const UM_DIA = 86_400_000;
//a fila continua depois do fim da sprint pelo calendário do dev (RF-113)
const HORIZONTE = 366;

const somarDias = (data: string, n: number) => paraTexto(new Date(paraData(data).getTime() + n * UM_DIA));
//"hoje" do servidor, em UTC, como as datas puras (ponto 29 do tecnico.md)
const hoje = () => new Date().toISOString().slice(0, 10);
const maior = (a: string, b: string) => (a > b ? a : b);

//"Sprint 3" → "Sprint 4"; nome fora do padrão ganha " (continuação)" (RF-118)
export const proximoNome = (nome: string) => {
  const m = nome.match(/^(.*?)(\d+)$/);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${nome} (continuação)`;
};

const proibido = () => new ForbiddenException('Apenas administradores podem planejar sprints');
const fechada = () => new HttpException('Sprint fechada', HttpStatus.CONFLICT);

const INCLUIR_ITEM = {
  tarefa: { select: SELECT_TAREFA },
  //"veio de <sprint>" no cartão (RF-117)
  itemOrigem: { select: { sprint: { select: { id: true, nome: true } } } },
} as const satisfies Prisma.ItensSprintInclude;
type ItemComTarefa = Prisma.ItensSprintGetPayload<{ include: typeof INCLUIR_ITEM }>;

//RF-112: horas planejadas do item
export const planejadasDo = (item: ItemComTarefa) => {
  if (item.minutosPlanejadosFixos !== null) return item.minutosPlanejadosFixos;
  if (!item.tarefa) return item.minutosAvulsos ?? 0;
  if (item.tarefa.minutosEstimados === null) return 0;
  return item.tarefa.minutosEstimados + (item.tarefa.minutosBuffer ?? 0);
};
const semEstimativa = (item: ItemComTarefa) => !!item.tarefa && item.minutosPlanejadosFixos === null && item.tarefa.minutosEstimados === null;

type SprintBruta = Prisma.SprintsGetPayload<object>;

//RF-121 (SPEC-025): status de conclusão = o primeiro status de tarefa final, na ordem do RF-43
export const statusDeConclusao = (db: Tx | PrismaService) =>
  db.statusTarefa.findFirst({ where: { isFinal: true }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] });
const periodo = (s: SprintBruta) => ({ inicio: paraTexto(s.dataInicio), fim: paraTexto(s.dataFim) });

@Injectable()
export class SprintsService {
  @Inject()
  private readonly prisma: PrismaService;

  @Inject()
  private readonly calendario: CalendarioService;

  // ---------- sprint (RF-109) ----------

  listar() {
    return this.prisma.sprints.findMany({ orderBy: [{ dataInicio: 'desc' }, { id: 'desc' }] });
  }

  obter(id: number) {
    return this.prisma.sprints.findUniqueOrThrow({ where: { id } });
  }

  private async semSobreposicao(db: Tx | PrismaService, inicio: string, fim: string, excetoId?: number) {
    const outra = await db.sprints.findFirst({
      where: { dataInicio: { lte: paraData(fim) }, dataFim: { gte: paraData(inicio) }, ...(excetoId && { id: { not: excetoId } }) },
      orderBy: { dataInicio: 'asc' },
    });
    if (outra) throw new HttpException(`O período se sobrepõe à sprint ${outra.nome}`, HttpStatus.CONFLICT);
  }

  private validarPeriodo(inicio: string, fim: string) {
    if (fim < inicio) throw new BadRequestException('A data de fim não pode ser anterior à de início');
  }

  //RF-119: avulsos recorrentes da sprint imediatamente anterior, no fim da fila de cada dev
  private async copiarRecorrentes(tx: Tx, nova: SprintBruta) {
    const anterior = await tx.sprints.findFirst({ where: { dataFim: { lt: nova.dataInicio }, id: { not: nova.id } }, orderBy: { dataFim: 'desc' } });
    if (!anterior) return;
    const recorrentes = await tx.itensSprint.findMany({
      where: { idSprint: anterior.id, idTarefa: null, recorrente: true },
      orderBy: [{ idUsuario: 'asc' }, { ordem: 'asc' }],
    });
    for (const r of recorrentes) {
      await tx.itensSprint.create({
        data: {
          idSprint: nova.id, idUsuario: r.idUsuario, nome: r.nome, minutosAvulsos: r.minutosAvulsos, recorrente: true,
          ordem: (await this.ultimaOrdem(tx, nova.id, r.idUsuario)) + 1,
        },
      });
    }
  }

  async criar(dto: CreateSprintDto, eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw proibido();
    this.validarPeriodo(dto.dataInicio, dto.dataFim);
    await this.semSobreposicao(this.prisma, dto.dataInicio, dto.dataFim);
    return this.prisma.$transaction(async (tx) => {
      const nova = await tx.sprints.create({ data: { nome: dto.nome.trim(), dataInicio: paraData(dto.dataInicio), dataFim: paraData(dto.dataFim) } });
      await this.copiarRecorrentes(tx, nova);
      return nova;
    });
  }

  //RF-109: nome e datas em Planejamento e em Ativa; a linha de base não muda (RF-114)
  async editar(id: number, dto: UpdateSprintDto, eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw proibido();
    const atual = await this.prisma.sprints.findUniqueOrThrow({ where: { id } });
    if (atual.status === 'Fechada') throw fechada();
    const inicio = dto.dataInicio ?? paraTexto(atual.dataInicio);
    const fim = dto.dataFim ?? paraTexto(atual.dataFim);
    this.validarPeriodo(inicio, fim);
    await this.semSobreposicao(this.prisma, inicio, fim, id);
    return this.prisma.sprints.update({
      where: { id },
      data: { ...(dto.nome !== undefined && { nome: dto.nome.trim() }), dataInicio: paraData(inicio), dataFim: paraData(fim) },
    });
  }

  async excluir(id: number, eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw proibido();
    const atual = await this.prisma.sprints.findUniqueOrThrow({ where: { id } });
    if (atual.status !== 'Planejamento') throw new HttpException('Só sprint em planejamento pode ser excluída', HttpStatus.CONFLICT);
    return this.prisma.$transaction(async (tx) => {
      const itens = await tx.itensSprint.findMany({ where: { idSprint: id }, select: { id: true, nome: true, tarefa: { select: { nome: true } } } });
      await desligarApontamentos(tx, itens.map((i) => ({ id: i.id, nome: i.tarefa?.nome ?? i.nome })));
      return tx.sprints.delete({ where: { id } });
    });
  }

  // ---------- itens (RF-110, RF-111) ----------

  private async ultimaOrdem(db: Tx | PrismaService, idSprint: number, idUsuario: number) {
    const ultimo = await db.itensSprint.findFirst({ where: { idSprint, idUsuario }, orderBy: { ordem: 'desc' }, select: { ordem: true } });
    return ultimo?.ordem ?? 0;
  }

  //regrava a fila do dev como 1..n, na ordem dada
  private async regravarOrdem(tx: Tx, ids: number[]) {
    for (const [i, id] of ids.entries()) await tx.itensSprint.update({ where: { id }, data: { ordem: i + 1 } });
  }

  private async idsDaFila(db: Tx | PrismaService, idSprint: number, idUsuario: number) {
    return (await db.itensSprint.findMany({ where: { idSprint, idUsuario }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }], select: { id: true } })).map((i) => i.id);
  }

  //posição 1-based; ausente ou além do fim = fim
  private inserir(ids: number[], id: number, posicao?: number) {
    const sem = ids.filter((x) => x !== id);
    const i = posicao === undefined ? sem.length : Math.min(Math.max(posicao - 1, 0), sem.length);
    sem.splice(i, 0, id);
    return sem;
  }

  private async exigirDev(db: Tx | PrismaService, idUsuario: number) {
    const usuario = await db.usuarios.findUniqueOrThrow({ where: { id: idUsuario }, select: { nome: true } });
    const jornadas = await db.jornadas.count({ where: { idUsuario } });
    if (jornadas === 0) throw new BadRequestException(`${usuario.nome} não tem jornada cadastrada`);
  }

  //RF-111: o dev vira responsável (com a atividade do RF-53) e, se preciso, membro do projeto (RF-26)
  private async alocarResponsavel(tx: Tx, idTarefa: number, idUsuario: number, autor: number) {
    const antes = await tx.tarefas.findUniqueOrThrow({ where: { id: idTarefa }, select: SELECT_TAREFA });
    let membroAdicionado: { idProjeto: number; nomeProjeto: string } | null = null;
    const vinculo = await tx.usuariosProjetos.findUnique({ where: { idUsuario_idProjeto: { idUsuario, idProjeto: antes.idProjeto } } });
    if (!vinculo) {
      await tx.usuariosProjetos.create({ data: { idUsuario, idProjeto: antes.idProjeto } });
      membroAdicionado = { idProjeto: antes.projeto.id, nomeProjeto: antes.projeto.nome };
    }
    if (antes.idUsuarioResponsavel !== idUsuario) {
      await tx.tarefas.update({ where: { id: idTarefa }, data: { idUsuarioResponsavel: idUsuario } });
      const depois = await tx.tarefas.findUniqueOrThrow({ where: { id: idTarefa }, select: SELECT_TAREFA });
      const mudancas = diferencas(antes, depois);
      if (mudancas.length > 0) {
        const nome = (await tx.usuarios.findUnique({ where: { id: autor }, select: { nome: true } }))?.nome ?? '';
        await tx.atividadesTarefa.createMany({ data: mudancas.map((m) => ({ ...m, idTarefa, idUsuario: autor, nomeUsuario: nome })) });
      }
    }
    return membroAdicionado;
  }

  async criarItem(idSprint: number, dto: CreateItemDto, eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw proibido();
    const sprint = await this.prisma.sprints.findUniqueOrThrow({ where: { id: idSprint } });
    if (sprint.status === 'Fechada') throw fechada();
    const deTarefa = dto.idTarefa !== undefined;
    if (deTarefa === (dto.nome !== undefined) || (!deTarefa && dto.minutosAvulsos === undefined)) {
      throw new BadRequestException('Informe a tarefa, ou o nome e as horas da linha avulsa');
    }
    await this.exigirDev(this.prisma, dto.idUsuario);
    if (deTarefa) {
      await this.prisma.tarefas.findUniqueOrThrow({ where: { id: dto.idTarefa }, select: { id: true } });
      const repetida = await this.prisma.itensSprint.count({ where: { idSprint, idTarefa: dto.idTarefa } });
      if (repetida > 0) throw new HttpException('A tarefa já está nesta sprint', HttpStatus.CONFLICT);
    }

    const resultado = await this.prisma.$transaction(async (tx) => {
      const item = await tx.itensSprint.create({
        data: {
          idSprint, idUsuario: dto.idUsuario, ordem: (await this.ultimaOrdem(tx, idSprint, dto.idUsuario)) + 1,
          naoPrevista: sprint.status === 'Ativa',
          ...(deTarefa ? { idTarefa: dto.idTarefa } : { nome: dto.nome!.trim(), minutosAvulsos: dto.minutosAvulsos, recorrente: dto.recorrente ?? false }),
        },
      });
      if (dto.posicao !== undefined) await this.regravarOrdem(tx, this.inserir(await this.idsDaFila(tx, idSprint, dto.idUsuario), item.id, dto.posicao));
      const membroAdicionado = deTarefa ? await this.alocarResponsavel(tx, dto.idTarefa!, dto.idUsuario, eu.id) : null;
      return { item, membroAdicionado };
    });

    //RF-114: o item não previsto grava a linha de base igual à projeção do momento
    if (sprint.status === 'Ativa') await this.congelarComoProjetado(sprint, dto.idUsuario, resultado.item.id);
    const item = await this.prisma.itensSprint.findUniqueOrThrow({ where: { id: resultado.item.id } });
    return { ...item, membroAdicionado: resultado.membroAdicionado };
  }

  //RF-132 (SPEC-026): aloca uma tarefa recém-criada na fila do dev, sem a checagem de admin (quem converte é o dono)
  async alocarTarefaInterno(tx: Tx, sprint: SprintBruta, idTarefa: number, idUsuario: number, autor: number) {
    const item = await tx.itensSprint.create({
      data: { idSprint: sprint.id, idUsuario, idTarefa, ordem: (await this.ultimaOrdem(tx, sprint.id, idUsuario)) + 1, naoPrevista: sprint.status === 'Ativa' },
    });
    await this.alocarResponsavel(tx, idTarefa, idUsuario, autor);
    return item;
  }

  async congelarComoProjetado(sprint: SprintBruta, idUsuario: number, idItem: number) {
    const fila = await this.filaDoDev(sprint, idUsuario);
    const pos = fila.projetado.get(idItem);
    await this.prisma.itensSprint.update({
      where: { id: idItem },
      data: { inicioPrevisto: pos?.inicio ? paraData(pos.inicio) : null, entregaPrevista: pos?.entrega ? paraData(pos.entrega) : null },
    });
  }

  async editarItem(id: number, dto: UpdateItemDto, eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw proibido();
    const item = await this.prisma.itensSprint.findUniqueOrThrow({ where: { id }, include: { sprint: true } });
    if (item.sprint.status === 'Fechada') throw fechada();
    const mexeAvulso = dto.nome !== undefined || dto.minutosAvulsos !== undefined || dto.recorrente !== undefined;
    if (mexeAvulso && item.idTarefa !== null) throw new BadRequestException('Nome, horas e "repetir" são só de linha avulsa');
    const novoDev = dto.idUsuario !== undefined && dto.idUsuario !== item.idUsuario ? dto.idUsuario : null;
    if (novoDev !== null) await this.exigirDev(this.prisma, novoDev);

    return this.prisma.$transaction(async (tx) => {
      let membroAdicionado: { idProjeto: number; nomeProjeto: string } | null = null;
      if (mexeAvulso) {
        await tx.itensSprint.update({
          where: { id },
          data: { ...(dto.nome !== undefined && { nome: dto.nome.trim() }), minutosAvulsos: dto.minutosAvulsos, recorrente: dto.recorrente },
        });
      }
      if (novoDev !== null) {
        //sai da fila antiga (que se regrava) e entra na do novo dev, no fim ou na posição pedida
        await tx.itensSprint.update({ where: { id }, data: { idUsuario: novoDev, ordem: (await this.ultimaOrdem(tx, item.idSprint, novoDev)) + 1 } });
        await this.regravarOrdem(tx, await this.idsDaFila(tx, item.idSprint, item.idUsuario));
        if (item.idTarefa !== null) membroAdicionado = await this.alocarResponsavel(tx, item.idTarefa, novoDev, eu.id);
      }
      const dev = novoDev ?? item.idUsuario;
      if (dto.posicao !== undefined) await this.regravarOrdem(tx, this.inserir(await this.idsDaFila(tx, item.idSprint, dev), id, dto.posicao));
      //RF-111: trocar o dev também avisa quando ele entrou no projeto
      return { ...(await tx.itensSprint.findUniqueOrThrow({ where: { id } })), membroAdicionado };
    });
  }

  async reordenar(idSprint: number, idUsuario: number, ids: number[], eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw proibido();
    const sprint = await this.prisma.sprints.findUniqueOrThrow({ where: { id: idSprint } });
    if (sprint.status === 'Fechada') throw fechada();
    const atuais = await this.idsDaFila(this.prisma, idSprint, idUsuario);
    if (atuais.length !== ids.length || [...atuais].sort().join() !== [...ids].sort().join()) {
      throw new BadRequestException('A lista precisa ter exatamente os itens da fila do dev');
    }
    await this.prisma.$transaction((tx) => this.regravarOrdem(tx, ids));
    return { ids };
  }

  async excluirItem(id: number, eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw proibido();
    const item = await this.prisma.itensSprint.findUniqueOrThrow({ where: { id }, include: { sprint: true, tarefa: { select: { nome: true } } } });
    if (item.sprint.status === 'Fechada') throw fechada();
    await this.prisma.$transaction(async (tx) => {
      await desligarApontamentos(tx, [{ id, nome: item.tarefa?.nome ?? item.nome }]);
      await tx.itensSprint.delete({ where: { id } });
      await this.regravarOrdem(tx, await this.idsDaFila(tx, item.idSprint, item.idUsuario));
    });
  }

  // ---------- fila e planejamento (RF-113..RF-115, RF-118) ----------

  private async itensDoDev(idSprint: number, idUsuario: number) {
    return this.prisma.itensSprint.findMany({ where: { idSprint, idUsuario }, include: INCLUIR_ITEM, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] });
  }

  //previsto (do início, horas planejadas) e projetado (de max(hoje, início), horas restantes), por item
  private async filaDoDev(sprint: SprintBruta, idUsuario: number) {
    const { inicio, fim } = periodo(sprint);
    const itens = await this.itensDoDev(sprint.id, idUsuario);
    const partida = maior(hoje(), inicio);
    const ate = somarDias(maior(fim, partida), HORIZONTE);
    const cal = await this.calendario.calendarioDe(idUsuario, inicio, ate);
    const diasDesde = (d: string) => capacidadeDosDias(d, ate, cal);

    const planejadas = new Map(itens.map((i) => [i.id, planejadasDo(i)]));
    const previsto = new Map<number, PosicaoNaFila>(
      calcularFila(diasDesde(inicio), fim, itens.map((i) => ({ id: i.id, minutos: planejadas.get(i.id)! }))).map((p) => [p.id, p]),
    );
    const abertos = itens.filter((i) => i.evolucao < 100);
    const projetado = new Map<number, PosicaoNaFila>(
      calcularFila(diasDesde(partida), fim, abertos.map((i) => ({ id: i.id, minutos: Math.round((planejadas.get(i.id)! * (100 - i.evolucao)) / 100) }))).map((p) => [p.id, p]),
    );
    const capacidade = capacidadeTotal(capacidadeDosDias(inicio, fim, cal));
    return { itens, planejadas, previsto, projetado, capacidade };
  }

  //próxima sprint para o transbordo: a em Planejamento que começa depois do fim desta; ou a que seria criada
  private async proximaSprint(db: Tx | PrismaService, sprint: SprintBruta) {
    const existente = await db.sprints.findFirst({ where: { status: 'Planejamento', dataInicio: { gt: sprint.dataFim } }, orderBy: { dataInicio: 'asc' } });
    return existente ?? null;
  }

  async planejamento(idSprint: number) {
    const sprint = await this.prisma.sprints.findUniqueOrThrow({ where: { id: idSprint } });
    const proxima = await this.proximaSprint(this.prisma, sprint);
    const destino = proxima ? { id: proxima.id, nome: proxima.nome } : { id: null, nome: proximoNome(sprint.nome) };

    //devs = quem tem jornada, mais quem já tem item nesta sprint (se a jornada foi apagada depois)
    const comJornada = (await this.prisma.jornadas.findMany({ select: { idUsuario: true }, distinct: ['idUsuario'] })).map((j) => j.idUsuario);
    const comItem = (await this.prisma.itensSprint.findMany({ where: { idSprint }, select: { idUsuario: true }, distinct: ['idUsuario'] })).map((i) => i.idUsuario);
    const usuarios = await this.prisma.usuarios.findMany({ where: { id: { in: [...new Set([...comJornada, ...comItem])] } }, select: SELECT_MEMBRO, orderBy: { nome: 'asc' } });

    const devs = await Promise.all(usuarios.map(async (usuario) => {
      const { itens, planejadas, previsto, projetado, capacidade } = await this.filaDoDev(sprint, usuario.id);
      const total = itens.reduce((soma, i) => soma + planejadas.get(i.id)!, 0);
      return {
        usuario,
        capacidade,
        planejadas: total,
        ocupacao: capacidade > 0 ? Math.round((total / capacidade) * 100) : null,
        semCapacidade: capacidade === 0 && itens.length > 0,
        itens: itens.map((i) => {
          const prev = previsto.get(i.id);
          const proj = projetado.get(i.id);
          //em Planejamento o transbordo vem do previsto; com a sprint Ativa, da projeção ("vai transbordar")
          const base = sprint.status === 'Planejamento' ? prev : sprint.status === 'Ativa' ? proj : undefined;
          const congelado = sprint.status !== 'Planejamento';
          return {
            id: i.id,
            ordem: i.ordem,
            tipo: i.tarefa ? 'tarefa' : 'avulso',
            tarefa: i.tarefa ? formatarTarefa(i.tarefa) : null,
            avulso: i.tarefa ? null : { nome: i.nome, recorrente: i.recorrente },
            planejadas: planejadas.get(i.id),
            semEstimativa: semEstimativa(i),
            naoPrevista: i.naoPrevista,
            evolucao: i.evolucao,
            inicioPrevisto: congelado ? (i.inicioPrevisto ? paraTexto(i.inicioPrevisto) : null) : (prev?.inicio ?? null),
            entregaPrevista: congelado ? (i.entregaPrevista ? paraTexto(i.entregaPrevista) : null) : (prev?.entrega ?? null),
            inicioProjetado: proj?.inicio ?? null,
            entregaProjetada: proj?.entrega ?? null,
            transborda: base && base.minutosTransbordo > 0 ? { minutos: base.minutosTransbordo, sprint: destino } : null,
            idItemOrigem: i.idItemOrigem,
            origem: i.itemOrigem ? i.itemOrigem.sprint : null,
          };
        }),
      };
    }));
    return { sprint, proxima: destino, devs };
  }

  // ---------- acompanhamento e cronograma (SPEC-025) ----------

  //RF-133 (SPEC-026): minutos apontados por item = soma dos apontamentos ligados
  protected async apontadasPorItem(ids: number[]): Promise<Map<number, number>> {
    const lista = await this.prisma.apontamentos.findMany({ where: { idItemSprint: { in: ids } }, select: { idItemSprint: true, inicioMin: true, fimMin: true } });
    const soma = new Map<number, number>();
    for (const a of lista) soma.set(a.idItemSprint!, (soma.get(a.idItemSprint!) ?? 0) + a.fimMin - a.inicioMin);
    return soma;
  }

  //RF-121 (a): a tarefa vai ao status de conclusão, se ainda não está num final, com a atividade do RF-53
  private async concluirTarefa(tx: Tx, idTarefa: number, autor: number) {
    const conclusao = await statusDeConclusao(tx);
    const antes = await tx.tarefas.findUniqueOrThrow({ where: { id: idTarefa }, select: SELECT_TAREFA });
    if (!conclusao || antes.status.isFinal) return;
    await tx.tarefas.update({ where: { id: idTarefa }, data: { idStatus: conclusao.id } });
    const depois = await tx.tarefas.findUniqueOrThrow({ where: { id: idTarefa }, select: SELECT_TAREFA });
    const nome = (await tx.usuarios.findUnique({ where: { id: autor }, select: { nome: true } }))?.nome ?? '';
    await tx.atividadesTarefa.createMany({ data: diferencas(antes, depois).map((m) => ({ ...m, idTarefa, idUsuario: autor, nomeUsuario: nome })) });
  }

  //RF-120
  async acompanhamento(id: number, dto: AcompanhamentoDto, eu: UsuarioAutenticado) {
    const item = await this.prisma.itensSprint.findUniqueOrThrow({ where: { id }, include: { sprint: true } });
    if (item.sprint.status === 'Fechada') throw fechada();
    if (!eu.isAdmin && item.idUsuario !== eu.id) throw new ForbiddenException('Só o dev do item ou o administrador atualizam o acompanhamento');
    const evolucao = dto.evolucao ?? item.evolucao;
    let entrega = item.dataEntregaReal;
    if (evolucao < 100) entrega = null;
    else if (!entrega) entrega = paraData(hoje());
    if (dto.dataEntregaReal !== undefined) entrega = dto.dataEntregaReal ? paraData(dto.dataEntregaReal) : null;
    const data: Prisma.ItensSprintUpdateInput = {
      evolucao,
      dataEntregaReal: entrega,
      ...(dto.bloqueio !== undefined && { bloqueio: dto.bloqueio?.trim() || null }),
      ...(dto.observacao !== undefined && { observacao: dto.observacao?.trim() || null }),
    };
    return this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.itensSprint.update({ where: { id }, data });
      if (item.idTarefa !== null && evolucao >= 100 && item.evolucao < 100) await this.concluirTarefa(tx, item.idTarefa, eu.id);
      return atualizado;
    });
  }

  //RF-126
  async cronograma(idSprint: number, { idProjeto, idUsuario }: QueryCronogramaDto) {
    const sprint = await this.prisma.sprints.findUniqueOrThrow({ where: { id: idSprint } });
    const { inicio, fim } = periodo(sprint);
    const hojeT = hoje();
    const congelado = sprint.status !== 'Planejamento';
    const proxima = await this.proximaSprint(this.prisma, sprint);
    const destino = proxima ? { id: proxima.id, nome: proxima.nome } : { id: null, nome: proximoNome(sprint.nome) };
    const devs = (await this.prisma.itensSprint.findMany({ where: { idSprint }, select: { idUsuario: true }, distinct: ['idUsuario'] })).map((i) => i.idUsuario);
    const usuarios = await this.prisma.usuarios.findMany({ where: { id: { in: devs } }, select: SELECT_MEMBRO, orderBy: { nome: 'asc' } });
    const apontadas = await this.apontadasPorItem((await this.prisma.itensSprint.findMany({ where: { idSprint }, select: { id: true } })).map((i) => i.id));

    const porDev0 = await Promise.all(usuarios.map(async (usuario) => {
      const { itens, planejadas, previsto, projetado } = await this.filaDoDev(sprint, usuario.id);
      //calendário do dev do menor ao maior dia envolvido, para dias úteis e atraso
      const datas = [inicio, fim, hojeT, ...itens.flatMap((i) => [i.inicioPrevisto, i.entregaPrevista, i.dataEntregaReal].filter((d): d is Date => !!d).map(paraTexto))];
      const de = datas.reduce((a, b) => (a < b ? a : b));
      const ate = datas.reduce((a, b) => (a > b ? a : b));
      const dias = capacidadeDosDias(de, ate, await this.calendario.calendarioDe(usuario.id, de, ate));
      return itens.map((i) => {
        const prev = previsto.get(i.id);
        const proj = projetado.get(i.id);
        const plan = planejadas.get(i.id)!;
        const ap = apontadas.get(i.id) ?? 0;
        const inicioPrevisto = congelado ? (i.inicioPrevisto ? paraTexto(i.inicioPrevisto) : null) : (prev?.inicio ?? null);
        const entregaPrevista = congelado ? (i.entregaPrevista ? paraTexto(i.entregaPrevista) : null) : (prev?.entrega ?? null);
        const dataEntregaReal = i.dataEntregaReal ? paraTexto(i.dataEntregaReal) : null;
        const concluida = i.evolucao >= 100;
        const atraso = atrasoDoItem({ concluida, entregaPrevista, dataEntregaReal, hoje: hojeT, dias });
        const base = sprint.status === 'Planejamento' ? prev : sprint.status === 'Ativa' ? proj : undefined;
        return {
          id: i.id,
          tipo: i.tarefa ? 'tarefa' : 'avulso',
          tarefa: i.tarefa ? formatarTarefa(i.tarefa) : null,
          avulso: i.tarefa ? null : { nome: i.nome, recorrente: i.recorrente },
          usuario,
          projeto: i.tarefa ? i.tarefa.projeto : null,
          naoPrevista: i.naoPrevista,
          planejadas: plan,
          apontadas: ap,
          consumo: consumoDoItem(ap, plan),
          restantes: restantesDoItem(plan, i.evolucao),
          evolucao: i.evolucao,
          status: statusDoItem({ evolucao: i.evolucao, bloqueio: i.bloqueio, apontadas: ap }),
          bloqueio: i.bloqueio,
          observacao: i.observacao,
          dataEntregaReal,
          inicioPrevisto,
          entregaPrevista,
          diasUteis: diasUteisNoPeriodo(dias, inicioPrevisto, entregaPrevista),
          inicioProjetado: proj?.inicio ?? null,
          entregaProjetada: proj?.entrega ?? null,
          atraso,
          risco: riscoDoItem({ concluida, atraso, entregaPrevista, entregaProjetada: proj?.entrega ?? null }),
          transborda: base && base.minutosTransbordo > 0 ? { minutos: base.minutosTransbordo, sprint: destino } : null,
          origem: i.itemOrigem ? i.itemOrigem.sprint : null,
        };
      });
    }));
    const linhas = porDev0.flat();

    const filtradas = linhas.filter((l) => (idUsuario === undefined || l.usuario.id === idUsuario) && (idProjeto === undefined || l.projeto?.id === idProjeto));
    const porDev = [...new Map(filtradas.map((l) => [l.usuario.id, l.usuario])).values()].map((usuario) => ({
      usuario, evolucao: evolucaoPonderada(filtradas.filter((l) => l.usuario.id === usuario.id)),
    }));
    const projetos = [...new Map(filtradas.filter((l) => l.projeto).map((l) => [l.projeto!.id, l.projeto!])).values()];
    const porProjeto = projetos.map((projeto) => ({ projeto, evolucao: evolucaoPonderada(filtradas.filter((l) => l.projeto?.id === projeto.id)) }));
    return { sprint, evolucao: { sprint: evolucaoPonderada(linhas), porDev, porProjeto }, itens: filtradas };
  }

  // ---------- ativação (RF-114, RF-118) ----------

  async ativar(id: number, eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw proibido();
    const sprint = await this.prisma.sprints.findUniqueOrThrow({ where: { id } });
    if (sprint.status !== 'Planejamento') throw new HttpException('Só sprint em planejamento pode ser ativada', HttpStatus.CONFLICT);
    const ativa = await this.prisma.sprints.findFirst({ where: { status: 'Ativa' } });
    if (ativa) throw new HttpException(`Já existe uma sprint ativa: ${ativa.nome}`, HttpStatus.CONFLICT);

    //o previsto de cada dev, calculado antes da transação (leituras do calendário fora dela)
    const devs = (await this.prisma.itensSprint.findMany({ where: { idSprint: id }, select: { idUsuario: true }, distinct: ['idUsuario'] })).map((i) => i.idUsuario);
    const filas = new Map<number, Awaited<ReturnType<SprintsService['filaDoDev']>>>();
    for (const dev of devs) filas.set(dev, await this.filaDoDev(sprint, dev));
    const transbordam = [...filas.values()].flatMap((f) => f.itens.filter((i) => (f.previsto.get(i.id)?.minutosTransbordo ?? 0) > 0));

    //próxima sprint: a existente ou uma nova, com a mesma duração, começando no dia seguinte ao fim
    const { inicio, fim } = periodo(sprint);
    const existente = transbordam.length ? await this.proximaSprint(this.prisma, sprint) : null;
    const novaInicio = somarDias(fim, 1);
    const novaFim = somarDias(novaInicio, Math.round((paraData(fim).getTime() - paraData(inicio).getTime()) / UM_DIA));
    if (transbordam.length && !existente) await this.semSobreposicao(this.prisma, novaInicio, novaFim);
    if (existente) {
      const conflito = await this.prisma.itensSprint.findFirst({
        where: { idSprint: existente.id, idTarefa: { in: transbordam.map((i) => i.idTarefa).filter((x): x is number => x !== null) } },
        include: { tarefa: { select: { nome: true } } },
      });
      if (conflito) throw new HttpException(`A tarefa ${conflito.tarefa?.nome} já está na sprint ${existente.nome}`, HttpStatus.CONFLICT);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.sprints.update({ where: { id }, data: { status: 'Ativa' } });
      let destino = existente;
      if (transbordam.length && !destino) {
        destino = await tx.sprints.create({ data: { nome: proximoNome(sprint.nome), dataInicio: paraData(novaInicio), dataFim: paraData(novaFim) } });
        await this.copiarRecorrentes(tx, destino);
      }

      for (const [dev, fila] of filas) {
        //itens já na próxima sprint, antes de chegar o transbordo (que vai para o topo)
        const jaLa = destino ? await this.idsDaFila(tx, destino.id, dev) : [];
        const novos: number[] = [];
        for (const item of fila.itens) {
          const pos = fila.previsto.get(item.id)!;
          const dados = item.idTarefa !== null ? { idTarefa: item.idTarefa } : { nome: item.nome, minutosAvulsos: item.minutosAvulsos, recorrente: item.recorrente };
          if (pos.minutosTransbordo > 0 && pos.minutosNaSprint === 0) {
            //transborda inteiro: sai daqui e vai para a próxima como item normal, levando os apontamentos
            const novo = await tx.itensSprint.create({ data: { ...dados, idSprint: destino!.id, idUsuario: dev, ordem: 0, minutosPlanejadosFixos: item.minutosPlanejadosFixos } });
            await tx.apontamentos.updateMany({ where: { idItemSprint: item.id }, data: { idItemSprint: novo.id } });
            await tx.itensSprint.delete({ where: { id: item.id } });
            novos.push(novo.id);
          } else if (pos.minutosTransbordo > 0) {
            //transborda em parte: fica com as horas que cabem; o resto vai ligado a ele
            await tx.itensSprint.update({
              where: { id: item.id },
              data: { minutosPlanejadosFixos: pos.minutosNaSprint, inicioPrevisto: paraData(pos.inicio!), entregaPrevista: paraData(pos.entregaNaSprint!) },
            });
            novos.push((await tx.itensSprint.create({ data: { ...dados, recorrente: false, idSprint: destino!.id, idUsuario: dev, ordem: 0, minutosPlanejadosFixos: pos.minutosTransbordo, idItemOrigem: item.id } })).id);
          } else {
            await tx.itensSprint.update({
              where: { id: item.id },
              data: { inicioPrevisto: pos.inicio ? paraData(pos.inicio) : null, entregaPrevista: pos.entrega ? paraData(pos.entrega) : null },
            });
          }
        }
        await this.regravarOrdem(tx, await this.idsDaFila(tx, id, dev));
        //no topo da fila do dev na próxima sprint, na ordem em que estavam
        if (novos.length) await this.regravarOrdem(tx, [...novos, ...jaLa]);
      }
      return tx.sprints.findUniqueOrThrow({ where: { id } });
    });
  }

  // ---------- fechamento (SPEC-027) ----------

  //tarefas não concluídas da sprint (itens de tarefa abaixo de 100%), na ordem dev → fila
  private async naoConcluidas(idSprint: number) {
    return this.prisma.itensSprint.findMany({
      where: { idSprint, idTarefa: { not: null }, evolucao: { lt: 100 } },
      include: { ...INCLUIR_ITEM, usuario: { select: SELECT_MEMBRO } },
      orderBy: [{ idUsuario: 'asc' }, { ordem: 'asc' }],
    });
  }

  //RF-136
  async previaFechamento(id: number) {
    const sprint = await this.prisma.sprints.findUniqueOrThrow({ where: { id } });
    const proxima = await this.proximaSprint(this.prisma, sprint);
    const itens = await this.naoConcluidas(id);
    return {
      sprint,
      proxima: proxima ? { id: proxima.id, nome: proxima.nome } : { id: null, nome: proximoNome(sprint.nome) },
      itens: itens.map((i) => ({
        id: i.id, tarefa: formatarTarefa(i.tarefa!), usuario: i.usuario, evolucao: i.evolucao, restantes: restantesDoItem(planejadasDo(i), i.evolucao),
      })),
    };
  }

  //a próxima sprint em planejamento, ou uma nova: nome em sequência, mesma duração, recorrentes copiados (RF-137, RF-118)
  private async proximaOuNova(tx: Tx, sprint: SprintBruta) {
    const existente = await this.proximaSprint(tx, sprint);
    if (existente) return existente;
    const { inicio, fim } = periodo(sprint);
    const novaInicio = somarDias(fim, 1);
    const novaFim = somarDias(novaInicio, Math.round((paraData(fim).getTime() - paraData(inicio).getTime()) / UM_DIA));
    await this.semSobreposicao(tx, novaInicio, novaFim);
    const nova = await tx.sprints.create({ data: { nome: proximoNome(sprint.nome), dataInicio: paraData(novaInicio), dataFim: paraData(novaFim) } });
    await this.copiarRecorrentes(tx, nova);
    return nova;
  }

  //RF-137
  async fechar(id: number, dto: FecharSprintDto, eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw proibido();
    const sprint = await this.prisma.sprints.findUniqueOrThrow({ where: { id } });
    if (sprint.status !== 'Ativa') throw new HttpException('Só sprint ativa pode ser fechada', HttpStatus.CONFLICT);
    const pendentes = await this.naoConcluidas(id);
    const escolhidos = new Map(dto.itens.map((i) => [i.id, i.destino]));
    if (escolhidos.size !== dto.itens.length || escolhidos.size !== pendentes.length || pendentes.some((p) => !escolhidos.has(p.id))) {
      throw new BadRequestException('Escolha o destino de todas as tarefas não concluídas');
    }
    const mover = pendentes.filter((p) => escolhidos.get(p.id) === 'proxima');
    if (mover.length) {
      const existente = await this.proximaSprint(this.prisma, sprint);
      if (existente) {
        const conflito = await this.prisma.itensSprint.findFirst({
          where: { idSprint: existente.id, idTarefa: { in: mover.map((m) => m.idTarefa!) } },
          include: { tarefa: { select: { nome: true } } },
        });
        if (conflito) throw new HttpException(`A tarefa ${conflito.tarefa?.nome} já está na sprint ${existente.nome}`, HttpStatus.CONFLICT);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const fechada = await tx.sprints.update({ where: { id }, data: { status: 'Fechada' } });
      let destino: SprintBruta | null = null;
      if (mover.length) {
        destino = await this.proximaOuNova(tx, sprint);
        //por dev, no topo da fila da próxima, na ordem em que estavam
        for (const dev of [...new Set(mover.map((m) => m.idUsuario))]) {
          const jaLa = await this.idsDaFila(tx, destino.id, dev);
          const novos: number[] = [];
          for (const m of mover.filter((x) => x.idUsuario === dev)) {
            const novo = await tx.itensSprint.create({
              data: { idSprint: destino.id, idUsuario: dev, idTarefa: m.idTarefa, ordem: 0, minutosPlanejadosFixos: restantesDoItem(planejadasDo(m), m.evolucao), idItemOrigem: m.id },
            });
            novos.push(novo.id);
          }
          await this.regravarOrdem(tx, [...novos, ...jaLa]);
        }
      }
      return { sprint: fechada, proxima: destino ? { id: destino.id, nome: destino.nome } : null };
    });
  }
}
