import { Inject, Injectable } from '@nestjs/common';
import { CreateComentariostarefaDto } from './dto/create-comentariostarefa.dto';
import { UpdateComentariostarefaDto } from './dto/update-comentariostarefa.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class ComentariostarefasService {
  @Inject()
  private readonly prisma: PrismaService

  create(createComentariostarefaDto: CreateComentariostarefaDto) {
    return this.prisma.comentariosTarefas.create({
      data: createComentariostarefaDto
    });
  }

  findAll() {
    return this.prisma.comentariosTarefas.findMany();
  }

  findOne(id: number) {
    return this.prisma.comentariosTarefas.findUnique({
      where: { id }
    });
  }

  findByTarefa(idTarefa: number) {
    return this.prisma.comentariosTarefas.findMany({
      where: {
        tarefa: { id: idTarefa }
      }
    });
  }

  update(id: number, updateComentariostarefaDto: UpdateComentariostarefaDto) {
    return this.prisma.comentariosTarefas.update({
      where: { id },
      data: updateComentariostarefaDto
    });
  }

  remove(id: number) {
    return this.prisma.comentariosTarefas.delete({
      where: { id }
    });
  }
}
