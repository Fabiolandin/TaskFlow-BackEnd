import { Inject, Injectable } from '@nestjs/common';
import { CreateTarefaDto } from './dto/create-tarefa.dto';
import { UpdateTarefaDto } from './dto/update-tarefa.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class TarefasService {
  @Inject()
  private readonly prisma: PrismaService

  create(createTarefaDto: CreateTarefaDto) {
    const { labelIds, ...dadosTarefa } = createTarefaDto
    return this.prisma.tarefas.create({
      data: {
        ...dadosTarefa,
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
    return this.prisma.tarefas.findMany();
  }

  findOne(id: number) {
    return this.prisma.tarefas.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        status: true,
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
  }

  update(id: number, updateTarefaDto: UpdateTarefaDto) {
    const { labelIds, ...dadosTarefa } = updateTarefaDto

    return this.prisma.$transaction(async (tx) => {
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
