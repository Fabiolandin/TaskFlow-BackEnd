import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateTarefaDto } from './dto/create-tarefa.dto';
import { UpdateTarefaDto } from './dto/update-tarefa.dto';
import { QueryTarefaDto } from './dto/query-tarefa.dto';
import { PrismaService } from 'src/database/prisma.service';
import { SELECT_MEMBRO } from 'src/membros/membros.service';

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
    const { page, limit, idProjeto, idStatus, idUsuarioResponsavel, idUsuarioCriador, idLabel, idUsuarioEnvolvido } = query
    const where: Prisma.TarefasWhereInput = {
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

  update(id: number, updateTarefaDto: UpdateTarefaDto) {
    const { labelIds, ...dadosTarefa } = updateTarefaDto

    return this.prisma.$transaction(async (tx) => {
      // RF-26: só confere quando o PATCH mexe no responsável ou no projeto; vale o estado final.
      if (dadosTarefa.idUsuarioResponsavel !== undefined || dadosTarefa.idProjeto !== undefined) {
        const atual = await tx.tarefas.findUnique({
          where: { id },
          select: { idUsuarioResponsavel: true, idProjeto: true },
        })
        if (atual) {
          await this.garantirResponsavelMembro(
            tx,
            dadosTarefa.idUsuarioResponsavel !== undefined ? dadosTarefa.idUsuarioResponsavel : atual.idUsuarioResponsavel,
            dadosTarefa.idProjeto ?? atual.idProjeto,
          )
        }
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
      return formatarTarefa(tarefa);
    })
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

      // só agora pode apagar a tarefa
      return tx.tarefas.delete({
        where: { id }
      });
    });
  }
}
