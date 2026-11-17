import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateTarefaDto } from './dto/create-tarefa.dto';
import { UpdateTarefaDto } from './dto/update-tarefa.dto';
import { QueryTarefaDto } from './dto/query-tarefa.dto';
import { PrismaService } from 'src/database/prisma.service';
import { SELECT_MEMBRO } from 'src/membros/membros.service';
import { idsComNome } from 'src/database/busca';
import { desligarApontamentos } from 'src/apontamentos/desligar';
import { anexarTrilhas, type Ancestral } from './trilha';
import { hojeLocal, paraData } from 'src/calendario/capacidade.logica';

// RF-32: um só formato de tarefa nas 4 rotas. Usuário só com SELECT_MEMBRO: nunca `senha`.
export const SELECT_TAREFA = {
  id: true,
  nome: true,
  descricao: true,
  idStatus: true,
  prioridade: true,
  data_inicio: true,
  data_final: true,
  createdAt: true,
  updatedAt: true,
  idUsuarioResponsavel: true,
  idUsuarioCriador: true,
  idProjeto: true,
  status: { select: { id: true, nome: true, cor: true, isFinal: true } },
  projeto: { select: { id: true, nome: true } },
  idTarefaPai: true,
  tarefaPai: { select: { id: true, nome: true } },
  // RF-32: só o isFinal de cada sub-tarefa direta, para a contagem
  subtarefas: { select: { status: { select: { isFinal: true } } } },
  // RF-108 (SPEC-024)
  minutosEstimados: true,
  minutosBuffer: true,
  issueExterna: true,
  solicitante: true,
  usuarioResponsavel: { select: SELECT_MEMBRO },
  usuarioCriador: { select: SELECT_MEMBRO },
  labelsTarefas: {
    select: { label: { select: { id: true, nome: true, cor: true } } },
    orderBy: { idLabel: 'asc' },
  },
} as const satisfies Prisma.TarefasSelect;

type TarefaBruta = Prisma.TarefasGetPayload<{ select: typeof SELECT_TAREFA }>;

// Renomeia responsável/criador e achata `labelsTarefas` em `labels: [{ id, nome, cor }]`.
export function formatarTarefa(tarefa: TarefaBruta) {
  const { usuarioResponsavel, usuarioCriador, labelsTarefas, subtarefas, ...resto } = tarefa;
  return {
    ...resto,
    subtarefas: { total: subtarefas.length, concluidas: subtarefas.filter((s) => s.status.isFinal).length },
    responsavel: usuarioResponsavel,
    criador: usuarioCriador,
    labels: labelsTarefas.map((v) => v.label),
    //caminho da raiz até a mãe direta; vazio até alguém chamar anexarTrilhas (backlog, fila, cronograma)
    ancestrais: [] as Ancestral[],
  };
}

type Mudanca = Pick<Prisma.AtividadesTarefaCreateManyInput, 'campo' | 'valorAnterior' | 'valorNovo' | 'idAnterior' | 'idNovo'>;

// dia AAAA-MM-DD em UTC, como a tela grava e mostra (ponto 22)
const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// RF-53: compara antes × depois e devolve uma mudança por campo que de fato mudou (label: uma por label)
export function diferencas(antes: TarefaBruta, depois: TarefaBruta): Mudanca[] {
  const lista: Mudanca[] = [];
  const comRegistro = (campo: string, a: { id: number; nome: string } | null, d: { id: number; nome: string } | null) => {
    if ((a?.id ?? null) !== (d?.id ?? null)) {
      lista.push({ campo, valorAnterior: a?.nome ?? null, valorNovo: d?.nome ?? null, idAnterior: a?.id ?? null, idNovo: d?.id ?? null });
    }
  };
  comRegistro('status', antes.status, depois.status);
  if (antes.prioridade !== depois.prioridade) {
    lista.push({ campo: 'prioridade', valorAnterior: antes.prioridade, valorNovo: depois.prioridade, idAnterior: null, idNovo: null });
  }
  comRegistro('responsavel', antes.usuarioResponsavel, depois.usuarioResponsavel);
  comRegistro('projeto', antes.projeto, depois.projeto);
  for (const campo of ['data_inicio', 'data_final'] as const) {
    if (dia(antes[campo]) !== dia(depois[campo])) {
      lista.push({ campo, valorAnterior: dia(antes[campo]), valorNovo: dia(depois[campo]), idAnterior: null, idNovo: null });
    }
  }
  const labelsAntes = antes.labelsTarefas.map((v) => v.label);
  const labelsDepois = depois.labelsTarefas.map((v) => v.label);
  for (const l of labelsDepois) {
    if (!labelsAntes.some((x) => x.id === l.id)) lista.push({ campo: 'label', valorAnterior: null, valorNovo: l.nome, idAnterior: null, idNovo: l.id });
  }
  for (const l of labelsAntes) {
    if (!labelsDepois.some((x) => x.id === l.id)) lista.push({ campo: 'label', valorAnterior: l.nome, valorNovo: null, idAnterior: l.id, idNovo: null });
  }
  // RF-53 alterado pela SPEC-024: refinamento, com o valor (minutos como texto)
  const texto = (v: string | number | null) => (v === null ? null : String(v));
  const refinamento = [['estimativa', 'minutosEstimados'], ['buffer', 'minutosBuffer'], ['issue', 'issueExterna'], ['solicitante', 'solicitante']] as const;
  for (const [campo, chave] of refinamento) {
    if (antes[chave] !== depois[chave]) {
      lista.push({ campo, valorAnterior: texto(antes[chave]), valorNovo: texto(depois[chave]), idAnterior: null, idNovo: null });
    }
  }
  // título e descrição: só registra que mudou (os quatro valores nulos)
  for (const campo of ['nome', 'descricao'] as const) {
    if (antes[campo] !== depois[campo]) lista.push({ campo, valorAnterior: null, valorNovo: null, idAnterior: null, idNovo: null });
  }
  return lista;
}

@Injectable()
export class TarefasService {
  @Inject()
  private readonly prisma: PrismaService

  // RF-26: o responsável, quando há, precisa ser membro do projeto da tarefa.
  private async garantirResponsavelMembro(
    db: Prisma.TransactionClient,
    idUsuarioResponsavel: number | null | undefined,
    idProjeto: number,
  ) {
    if (idUsuarioResponsavel === null || idUsuarioResponsavel === undefined) return
    const vinculo = await db.usuariosProjetos.findUnique({
      where: { idUsuario_idProjeto: { idUsuario: idUsuarioResponsavel, idProjeto } },
      select: { id: true },
    })
    if (!vinculo) {
      throw new HttpException(
        'O responsável precisa ser membro do projeto da tarefa',
        HttpStatus.BAD_REQUEST,
      )
    }
  }

  // RF-33: label inexistente recusa o pedido, nomeando os ids, antes de gravar qualquer coisa.
  private async garantirLabelsExistem(db: Prisma.TransactionClient, labelIds: number[] | undefined) {
    if (!labelIds || labelIds.length === 0) return
    const existentes = await db.labels.findMany({
      where: { id: { in: labelIds } },
      select: { id: true },
    })
    const achados = new Set(existentes.map((l) => l.id))
    const faltando = labelIds.filter((id) => !achados.has(id))
    if (faltando.length > 0) {
      throw new HttpException(
        `Label inexistente: ${faltando.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      )
    }
  }

  // RF-65: a pai existe e é do mesmo projeto
  private async garantirPai(idTarefaPai: number | undefined, idProjeto: number) {
    if (idTarefaPai === undefined) return
    const pai = await this.prisma.tarefas.findUnique({ where: { id: idTarefaPai }, select: { idProjeto: true } })
    if (!pai) {
      throw new HttpException(`Tarefa-pai inexistente: ${idTarefaPai}`, HttpStatus.BAD_REQUEST)
    }
    if (pai.idProjeto !== idProjeto) {
      throw new HttpException('A sub-tarefa precisa estar no projeto da tarefa-pai', HttpStatus.BAD_REQUEST)
    }
  }

  async create(createTarefaDto: CreateTarefaDto, idUsuarioCriador: number) {
    const { labelIds, ...dadosTarefa } = createTarefaDto
    await this.garantirPai(dadosTarefa.idTarefaPai, dadosTarefa.idProjeto)
    await this.garantirResponsavelMembro(this.prisma, dadosTarefa.idUsuarioResponsavel, dadosTarefa.idProjeto)
    await this.garantirLabelsExistem(this.prisma, labelIds)
    const tarefa = await this.prisma.tarefas.create({
      data: {
        ...dadosTarefa,
        idUsuarioCriador,
        labelsTarefas: {
          create: labelIds?.map(idLabel => ({
            label: { connect: { id: idLabel } }
          }))
        }
      },
      select: SELECT_TAREFA,
    })
    return formatarTarefa(tarefa)
  }

  //ids + todos os descendentes (até 20 níveis, como a trilha)
  private async comDescendentes(ids: number[]): Promise<number[]> {
    const todos = new Set(ids);
    let fronteira = ids;
    for (let nivel = 0; nivel < 20 && fronteira.length > 0; nivel++) {
      const filhas = await this.prisma.tarefas.findMany({ where: { idTarefaPai: { in: fronteira } }, select: { id: true } });
      fronteira = filhas.map((f) => f.id).filter((id) => !todos.has(id));
      fronteira.forEach((id) => todos.add(id));
    }
    return [...todos];
  }

  async findAll(query: QueryTarefaDto) {
    const { page, limit, idProjeto, idStatus, idUsuarioResponsavel, idUsuarioCriador, idLabel, idUsuarioEnvolvido, busca, idTarefaPai, raiz, foraDeSprint } = query
    // RF-56: nome contém o texto; vazia equivale a sem busca
    // RF-149 (SPEC-028): no backlog, buscar pela mãe acha as filhas (a mãe não aparece sozinha, RF-141)
    const achadas = busca ? await idsComNome(this.prisma, 'Tarefas', busca) : null
    const where: Prisma.TarefasWhereInput = {
      ...(achadas && { id: { in: foraDeSprint ? await this.comDescendentes(achadas) : achadas } }),
      idProjeto,
      idStatus,
      idUsuarioResponsavel,
      idUsuarioCriador,
      idTarefaPai: raiz ? null : idTarefaPai,
      ...(idLabel !== undefined && { labelsTarefas: { some: { idLabel } } }),
      ...(idUsuarioEnvolvido !== undefined && {
        OR: [{ idUsuarioResponsavel: idUsuarioEnvolvido }, { idUsuarioCriador: idUsuarioEnvolvido }],
      }),
      // RF-116 (SPEC-024): backlog
      ...(foraDeSprint && {
        status: { isFinal: false },
        itensSprint: { none: { sprint: { status: { in: ['Planejamento', 'Ativa'] } } } },
        // RF-141 (SPEC-028): tarefa com sub-tarefas não é planejável; aparece pela trilha das filhas
        subtarefas: { none: {} },
      }),
    }
    const [total, tarefas] = await Promise.all([
      this.prisma.tarefas.count({ where }),
      this.prisma.tarefas.findMany({
        where,
        select: SELECT_TAREFA,
        orderBy: { id: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])
    const data = tarefas.map(formatarTarefa)
    //backlog da sprint mostra a árvore por tema
    if (foraDeSprint) await anexarTrilhas(this.prisma, data)
    return { data, total, page, totalPages: Math.ceil(total / limit) }
  }

  async findOne(id: number) {
    const tarefa = await this.prisma.tarefas.findUnique({ where: { id }, select: SELECT_TAREFA })
    if (!tarefa) {
      throw new NotFoundException(`Tarefa ${id} não encontrada`)
    }
    return formatarTarefa(tarefa)
  }

  update(id: number, updateTarefaDto: UpdateTarefaDto, idUsuario: number, isAdmin = false) {
    const { labelIds, ...dadosTarefa } = updateTarefaDto

    return this.prisma.$transaction(async (tx) => {
      // RF-53: o estado anterior, para comparar com a releitura do fim (D-3)
      const antes = await tx.tarefas.findUnique({ where: { id }, select: SELECT_TAREFA })

      // RF-108 (SPEC-024): estimativa e buffer só pelo admin ou pelo responsável
      if (antes && (dadosTarefa.minutosEstimados !== undefined || dadosTarefa.minutosBuffer !== undefined)
        && !isAdmin && antes.idUsuarioResponsavel !== idUsuario) {
        throw new ForbiddenException('Só o administrador ou o responsável podem estimar a tarefa')
      }

      // RF-66: sub-tarefa, ou tarefa com sub-tarefas, não muda de projeto
      if (antes && dadosTarefa.idProjeto !== undefined && dadosTarefa.idProjeto !== antes.idProjeto
        && (antes.idTarefaPai !== null || antes.subtarefas.length > 0)) {
        throw new HttpException('Sub-tarefa, ou tarefa com sub-tarefas, não muda de projeto', HttpStatus.BAD_REQUEST)
      }

      // RF-26: só confere quando o PATCH mexe no responsável ou no projeto; vale o estado final.
      if (antes && (dadosTarefa.idUsuarioResponsavel !== undefined || dadosTarefa.idProjeto !== undefined)) {
        await this.garantirResponsavelMembro(
          tx,
          dadosTarefa.idUsuarioResponsavel !== undefined ? dadosTarefa.idUsuarioResponsavel : antes.idUsuarioResponsavel,
          dadosTarefa.idProjeto ?? antes.idProjeto,
        )
      }

      // RF-33: antes de gravar, para o PATCH recusado deixar tarefa e vínculos intactos
      await this.garantirLabelsExistem(tx, labelIds)

      //atualizar os campos padrões das tarefas
      await tx.tarefas.update({
        where: { id },
        data: dadosTarefa
      });

      //só atualiza se as labels vieram no update como null/undefined 
      if (labelIds !== undefined) {
        //apaga todos os links antigos
        await tx.labelsTarefas.deleteMany({
          where: { idTarefa: id }
        });

        //recria a linkagem com as novas labels
        if (labelIds.length > 0) {
          await tx.labelsTarefas.createMany({
            data: labelIds.map(idLabel => ({
              idTarefa: id,
              idLabel: idLabel
            }))
          });
        }
      }
      // RF-32: relê depois da substituição, para devolver as labels novas
      const tarefa = await tx.tarefas.findUniqueOrThrow({ where: { id }, select: SELECT_TAREFA })

      // RF-121 (b) (SPEC-025): passar ao status de conclusão leva os itens abertos da tarefa a 100%
      if (antes && antes.idStatus !== tarefa.idStatus) {
        const conclusao = await tx.statusTarefa.findFirst({ where: { isFinal: true }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] })
        if (conclusao && tarefa.idStatus === conclusao.id) {
          const abertos = { idTarefa: id, evolucao: { lt: 100 }, sprint: { status: { in: ['Planejamento', 'Ativa'] } } }
          await tx.itensSprint.updateMany({ where: { ...abertos, dataEntregaReal: null }, data: { dataEntregaReal: paraData(hojeLocal()) } })
          await tx.itensSprint.updateMany({ where: abertos, data: { evolucao: 100 } })
        } else if (antes.status.isFinal && !tarefa.status.isFinal) {
          // RF-121 (c) (SPEC-028): sair de um status final (Concluído, Cancelado…) para um não final reabre os itens
          // dela nas sprints abertas (a evolução anterior não fica guardada: volta a 0 e a entrega real é limpa)
          await tx.itensSprint.updateMany({
            where: { idTarefa: id, evolucao: { gte: 100 }, sprint: { status: { in: ['Planejamento', 'Ativa'] } } },
            data: { evolucao: 0, dataEntregaReal: null },
          })
        }
      }

      // RF-53: uma atividade por campo que mudou, na mesma transação; se não grava, nada grava
      // (token de usuário excluído: a FK do autor falha → P2003 → 400 e rollback)
      if (antes) {
        const mudancas = diferencas(antes, tarefa)
        if (mudancas.length > 0) {
          const autor = await tx.usuarios.findUnique({ where: { id: idUsuario }, select: { nome: true } })
          await tx.atividadesTarefa.createMany({
            data: mudancas.map((m) => ({ ...m, idTarefa: id, idUsuario, nomeUsuario: autor?.nome ?? '' })),
          })
        }
      }
      return formatarTarefa(tarefa);
    })
  }

  // RF-54: histórico em ordem crescente (createdAt, id); autor só com SELECT_MEMBRO, nunca `senha`
  async findAtividades(id: number) {
    const tarefa = await this.prisma.tarefas.findUnique({ where: { id }, select: { id: true } })
    if (!tarefa) {
      throw new NotFoundException(`Tarefa ${id} não encontrada`)
    }
    const atividades = await this.prisma.atividadesTarefa.findMany({
      where: { idTarefa: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        idTarefa: true,
        campo: true,
        valorAnterior: true,
        valorNovo: true,
        idAnterior: true,
        idNovo: true,
        createdAt: true,
        idUsuario: true,
        nomeUsuario: true,
        usuario: { select: SELECT_MEMBRO },
      },
    })
    return atividades.map(({ usuario, ...resto }) => ({ ...resto, autor: usuario }))
  }

  // RF-15/RF-16 alterados pela SPEC-024: tarefa em sprint pede confirmação (removerDaSprint) e sai das sprints
  async remove(id: number, removerDaSprint = false) {
    return this.prisma.$transaction(async (tx) => {
      const itens = await tx.itensSprint.findMany({
        where: { idTarefa: id },
        select: { id: true, sprint: { select: { id: true, nome: true, status: true, dataInicio: true } } },
      })
      if (itens.length > 0) {
        if (!removerDaSprint) {
          const sprints = [...new Map(itens.map((i) => [i.sprint.id, i.sprint])).values()]
            .sort((a, b) => a.dataInicio.getTime() - b.dataInicio.getTime())
          const nomes = sprints.map((sp) => sp.nome).join(', ')
          throw new HttpException({
            message: (sprints.length === 1 ? 'Tarefa está na sprint ' : 'Tarefa está nas sprints ') + nomes,
            detalhes: { emSprint: sprints.map((sp) => ({ id: sp.id, nome: sp.nome, status: sp.status })) },
          }, HttpStatus.CONFLICT)
        }
        //RF-134 (SPEC-026): os apontamentos dos itens ficam sem item, com a observação
        const nome = (await tx.tarefas.findUnique({ where: { id }, select: { nome: true } }))?.nome ?? null
        await desligarApontamentos(tx, itens.map((i) => ({ id: i.id, nome })))
        //quem veio do transbordo destes itens perde a ligação; depois os itens saem
        await tx.itensSprint.updateMany({ where: { idItemOrigem: { in: itens.map((i) => i.id) } }, data: { idItemOrigem: null } })
        await tx.itensSprint.deleteMany({ where: { idTarefa: id } })
      }

      // RF-66: a sub-tarefa impede excluir a pai (RF-16)
      const filhas = await tx.tarefas.count({ where: { idTarefaPai: id } })
      if (filhas > 0) {
        throw new HttpException(
          `Tarefa em uso: tem ${filhas} sub-tarefa(s). Exclua as sub-tarefas antes de excluir a tarefa.`,
          HttpStatus.CONFLICT,
        )
      }
      // apaga os links de labels primeiro
      await tx.labelsTarefas.deleteMany({
        where: { idTarefa: id }
      });

      // apaga os comentários também
      await tx.comentariosTarefas.deleteMany({
        where: { idTarefa: id } // ajusta o nome do campo conforme seu schema
      });

      // e o histórico (RF-15)
      await tx.atividadesTarefa.deleteMany({
        where: { idTarefa: id }
      });

      // só agora pode apagar a tarefa
      return tx.tarefas.delete({
        where: { id }
      });
    });
  }
}
