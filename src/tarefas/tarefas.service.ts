import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateTarefaDto } from './dto/create-tarefa.dto';
import { UpdateTarefaDto } from './dto/update-tarefa.dto';
import { PrismaService } from 'src/database/prisma.service';

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

  async create(createTarefaDto: CreateTarefaDto, idUsuarioCriador: number) {
    const { labelIds, ...dadosTarefa } = createTarefaDto
    await this.garantirResponsavelMembro(this.prisma, dadosTarefa.idUsuarioResponsavel, dadosTarefa.idProjeto)
    return this.prisma.tarefas.create({
      data: {
        ...dadosTarefa,
        idUsuarioCriador,
        labelsTarefas: {
          create: labelIds?.map(idLabel => ({
            label: { connect: { id: idLabel } }
          }))
        }
      },
      include: { labelsTarefas: { include: { label: true } } }
    })
  }

  findAll() {
    return this.prisma.tarefas.findMany({ include: { status: true } });
  }

  async findOne(id: number) {
    const tarefa = await this.prisma.tarefas.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        idStatus: true,
        status: { select: { id: true, nome: true, cor: true, isFinal: true } },
        prioridade: true,
        data_inicio: true,
        data_final: true,
        createdAt: true,
        idUsuarioResponsavel: true,
        idUsuarioCriador: true,
        idProjeto: true,
        labelsTarefas: { select: { label: { select: { id: true, nome: true } } } }
      }
    })
    if (!tarefa) {
      throw new NotFoundException(`Tarefa ${id} não encontrada`)
    }

    return tarefa;
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

      //atualizar os campos padrões das tarefas
      const tarefa = await tx.tarefas.update({
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
      return tarefa;
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
