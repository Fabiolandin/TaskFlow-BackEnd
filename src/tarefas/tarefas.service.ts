import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateTarefaDto } from './dto/create-tarefa.dto';
import { UpdateTarefaDto } from './dto/update-tarefa.dto';
import { QueryTarefaDto } from './dto/query-tarefa.dto';
import { PrismaService } from 'src/database/prisma.service';
import { SELECT_MEMBRO } from 'src/membros/membros.service';
import { idsComNome } from 'src/database/busca';

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
  usuarioResponsavel: { select: SELECT_MEMBRO },
  usuarioCriador: { select: SELECT_MEMBRO },
  labelsTarefas: {
    select: { label: { select: { id: true, nome: true } } },
    orderBy: { idLabel: 'asc' },
  },
} as const satisfies Prisma.TarefasSelect;

type TarefaBruta = Prisma.TarefasGetPayload<{ select: typeof SELECT_TAREFA }>;

// Renomeia responsável/criador e achata `labelsTarefas` em `labels: [{ id, nome }]`.
export function formatarTarefa(tarefa: TarefaBruta) {
  const { usuarioResponsavel, usuarioCriador, labelsTarefas, ...resto } = tarefa;
  return {
    ...resto,
    responsavel: usuarioResponsavel,
    criador: usuarioCriador,
    labels: labelsTarefas.map((v) => v.label),
  };
}

type Mudanca = Pick<Prisma.AtividadesTarefaCreateManyInput, 'campo' | 'valorAnterior' | 'valorNovo' | 'idAnterior' | 'idNovo'>;

// dia AAAA-MM-DD em UTC, como a tela grava e mostra (ponto 22)
const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// RF-53: compara antes × depois e devolve uma mudança por campo que de fato mudou (label: uma por label)
function diferencas(antes: TarefaBruta, depois: TarefaBruta): Mudanca[] {
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

  async create(createTarefaDto: CreateTarefaDto, idUsuarioCriador: number) {
    const { labelIds, ...dadosTarefa } = createTarefaDto
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

  async findAll(query: QueryTarefaDto) {
    const { page, limit, idProjeto, idStatus, idUsuarioResponsavel, idUsuarioCriador, idLabel, idUsuarioEnvolvido, busca } = query
    const where: Prisma.TarefasWhereInput = {
      // RF-56: nome contém o texto; vazia equivale a sem busca
      ...(busca && { id: { in: await idsComNome(this.prisma, 'Tarefas', busca) } }),
      idProjeto,
      idStatus,
      idUsuarioResponsavel,
      idUsuarioCriador,
      ...(idLabel !== undefined && { labelsTarefas: { some: { idLabel } } }),
      ...(idUsuarioEnvolvido !== undefined && {
        OR: [{ idUsuarioResponsavel: idUsuarioEnvolvido }, { idUsuarioCriador: idUsuarioEnvolvido }],
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
    return { data: tarefas.map(formatarTarefa), total, page, totalPages: Math.ceil(total / limit) }
  }

  async findOne(id: number) {
    const tarefa = await this.prisma.tarefas.findUnique({ where: { id }, select: SELECT_TAREFA })
    if (!tarefa) {
      throw new NotFoundException(`Tarefa ${id} não encontrada`)
    }
    return formatarTarefa(tarefa)
  }

  update(id: number, updateTarefaDto: UpdateTarefaDto, idUsuario: number) {
    const { labelIds, ...dadosTarefa } = updateTarefaDto

    return this.prisma.$transaction(async (tx) => {
      // RF-53: o estado anterior, para comparar com a releitura do fim (D-3)
      const antes = await tx.tarefas.findUnique({ where: { id }, select: SELECT_TAREFA })

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

  async remove(id: number) {
    return this.prisma.$transaction(async (tx) => {
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
