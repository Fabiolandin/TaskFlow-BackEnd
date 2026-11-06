import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStatusprojetoDto } from './dto/create-statusprojeto.dto';
import { UpdateStatusprojetoDto } from './dto/update-statusprojeto.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class StatusprojetoService {
  @Inject()
  private readonly prisma: PrismaService

  create(createStatusprojetoDto: CreateStatusprojetoDto) {
    return this.prisma.statusProjeto.create({
      data: createStatusprojetoDto
    })
  }

  findAll() {
    return this.prisma.statusProjeto.findMany({
      orderBy: { ordem: 'asc' }
    });
  }

  async findOne(id: number) {
    const status = await this.prisma.statusProjeto.findUnique({
      where: { id },
    });

    if (!status) {
      throw new NotFoundException(`Status de projeto ${id} não encontrado`)
    }

    return status;
  }

  update(id: number, updateStatusprojetoDto: UpdateStatusprojetoDto) {
    return this.prisma.statusProjeto.update({
      where: { id },
      data: updateStatusprojetoDto
    })
  }

  remove(id: number) {
    return this.prisma.statusProjeto.delete({
      where: { id },
    })
  }
}
