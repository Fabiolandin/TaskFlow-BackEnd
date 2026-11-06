import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateProjetoDto } from './dto/create-projeto.dto';
import { UpdateProjetoDto } from './dto/update-projeto.dto';
import { PrismaService } from 'src/database/prisma.service';
import { INCLUDE_MEMBROS, comMembros } from 'src/membros/membros.service';

@Injectable()
export class ProjetosService {
  @Inject()
  private readonly prisma: PrismaService

  create(createProjetoDto: CreateProjetoDto) {
    return this.prisma.projetos.create({
      data: createProjetoDto
    });
  }

  async findAll(page: number = 1, limit: number = 9) {
    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.prisma.projetos.findMany({
        skip,
        take: limit,
        orderBy: { id: 'asc' },
        include: { status: true, usuariosProjetos: INCLUDE_MEMBROS },
      }),
      this.prisma.projetos.count(),
    ])
    return { data: data.map(comMembros), total, page, totalPages: Math.ceil(total / limit) }
  }

  async findOne(id: number) {
    const projeto = await this.prisma.projetos.findUnique({
      where: { id },
      include: { status: true, usuariosProjetos: INCLUDE_MEMBROS }
    });

    if (!projeto) {
      throw new NotFoundException(`Projeto ${id} não encontrado`)
    }

    return comMembros(projeto);
  }

  update(id: number, updateProjetoDto: UpdateProjetoDto) {
    return this.prisma.projetos.update({
      where: { id },
      data: updateProjetoDto
    });
  }

  remove(id: number) {
    return this.prisma.projetos.delete({
      where: { id }
    });
  }
}
