import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateComentariostarefaDto } from './dto/create-comentariostarefa.dto';
import { UpdateComentariostarefaDto } from './dto/update-comentariostarefa.dto';
import { PrismaService } from 'src/database/prisma.service';
import { SELECT_MEMBRO } from 'src/membros/membros.service';

// RF-35: formato único nas rotas de comentário. O autor sai só com SELECT_MEMBRO, nunca `senha`.
const INCLUDE_AUTOR = { usuario: { select: SELECT_MEMBRO } } as const;

// A relação do schema chama `usuario`; na resposta ela sai como `autor`.
function comAutor<T extends { usuario: unknown }>(comentario: T) {
  const { usuario, ...resto } = comentario;
  return { ...resto, autor: usuario };
}
// Ordem crescente de criação; o id desempata.
const ORDEM = [{ createdAt: 'asc' }, { id: 'asc' }] as const;

@Injectable()
export class ComentariostarefasService {
  @Inject()
  private readonly prisma: PrismaService

  async create(createComentariostarefaDto: CreateComentariostarefaDto, idUsuario: number) {
    return comAutor(await this.prisma.comentariosTarefas.create({
      data: { ...createComentariostarefaDto, idUsuario },
      include: INCLUDE_AUTOR,
    }));
  }

  async findAll() {
    const comentarios = await this.prisma.comentariosTarefas.findMany({ include: INCLUDE_AUTOR, orderBy: [...ORDEM] });
    return comentarios.map(comAutor);
  }

  async findOne(id: number) {
    const comentario = await this.prisma.comentariosTarefas.findUnique({
      where: { id },
      include: INCLUDE_AUTOR,
    });

    if (!comentario) {
      throw new NotFoundException(`Comentário ${id} não encontrado`)
    }

    return comAutor(comentario);
  }

  async findByTarefa(idTarefa: number) {
    const comentarios = await this.prisma.comentariosTarefas.findMany({
      where: {
        tarefa: { id: idTarefa }
      },
      include: INCLUDE_AUTOR,
      orderBy: [...ORDEM],
    });
    return comentarios.map(comAutor);
  }

  // RF-36: só o autor edita, e só o texto (idTarefa e idUsuario nunca mudam).
  async update(id: number, updateComentariostarefaDto: UpdateComentariostarefaDto, idUsuario: number) {
    const atual = await this.findOne(id);
    if (atual.idUsuario !== idUsuario) {
      throw new ForbiddenException('Só o autor pode editar o comentário');
    }
    return comAutor(await this.prisma.comentariosTarefas.update({
      where: { id },
      data: { comentario: updateComentariostarefaDto.comentario },
      include: INCLUDE_AUTOR,
    }));
  }

  remove(id: number) {
    return this.prisma.comentariosTarefas.delete({
      where: { id }
    });
  }
}
