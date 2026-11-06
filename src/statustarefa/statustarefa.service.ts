import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStatustarefaDto } from './dto/create-statustarefa.dto';
import { UpdateStatustarefaDto } from './dto/update-statustarefa.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class StatustarefaService {
  @Inject()
  private readonly prisma: PrismaService

  create(createStatustarefaDto: CreateStatustarefaDto) {
    return this.prisma.statusTarefa.create({
      data: createStatustarefaDto
    })
  }

  findAll() {
    return this.prisma.statusTarefa.findMany({
      orderBy: { ordem: 'asc' }
    });
  }

  async findOne(id: number) {
    const status = await this.prisma.statusTarefa.findUnique({
      where: { id },
    });

    if (!status) {
      throw new NotFoundException(`Status de tarefa ${id} não encontrado`)
    }

    return status;
  }

  update(id: number, updateStatustarefaDto: UpdateStatustarefaDto) {
    return this.prisma.statusTarefa.update({
      where: { id },
      data: updateStatustarefaDto
    })
  }

  remove(id: number) {
    return this.prisma.statusTarefa.delete({
      where: { id },
    })
  }
}
