import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateProjetoDto } from './dto/create-projeto.dto';
import { UpdateProjetoDto } from './dto/update-projeto.dto';
import { PrismaService } from 'src/database/prisma.service';
import { INCLUDE_MEMBROS, comMembros } from 'src/membros/membros.service';

@Injectable()
export class ProjetosService {
  @Inject()
  private readonly prisma: PrismaService

  // RF-28: projeto e membros numa gravação só. A escrita aninhada do Prisma já roda numa
  // transação; um usuário apagado entre a checagem e o create cai no P2003 (400, SPEC-011).
  async create(createProjetoDto: CreateProjetoDto) {
    const { membros = [], ...dados } = createProjetoDto;

    if (membros.length) {
      const existentes = await this.prisma.usuarios.findMany({
        where: { id: { in: membros } },
        select: { id: true },
      });
      const achados = new Set(existentes.map((u) => u.id));
      const faltando = membros.filter((id) => !achados.has(id));
      if (faltando.length) {
        throw new HttpException(
          `Usuário(s) não encontrado(s): ${faltando.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const projeto = await this.prisma.projetos.create({
      data: {
        ...dados,
        usuariosProjetos: { create: membros.map((idUsuario) => ({ idUsuario })) },
      },
      include: { status: true, usuariosProjetos: INCLUDE_MEMBROS },
    });
    return comMembros(projeto);
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
