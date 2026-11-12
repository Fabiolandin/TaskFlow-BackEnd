import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStatustarefaDto } from './dto/create-statustarefa.dto';
import { UpdateStatustarefaDto } from './dto/update-statustarefa.dto';
import { ReordenarStatustarefaDto } from './dto/reordenar-statustarefa.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class StatustarefaService {
  @Inject()
  private readonly prisma: PrismaService

  // RF-21: sem ordem, vai para o fim (maior ordem + 1; 1 no cadastro vazio)
  async create(createStatustarefaDto: CreateStatustarefaDto) {
    const { ordem, ...resto } = createStatustarefaDto
    const fim = ordem ?? ((await this.prisma.statusTarefa.aggregate({ _max: { ordem: true } }))._max.ordem ?? 0) + 1
    return this.prisma.statusTarefa.create({
      data: { ...resto, ordem: fim }
    })
  }

  // RF-62: a lista inteira, na ordem nova; grava ordem = posição numa transação, ou nada
  reordenar({ ids }: ReordenarStatustarefaDto) {
    return this.prisma.$transaction(async (tx) => {
      const existentes = (await tx.statusTarefa.findMany({ select: { id: true } })).map((s) => s.id)
      const faltando = existentes.filter((id) => !ids.includes(id))
      const estranhos = ids.filter((id) => !existentes.includes(id))
      if (faltando.length > 0 || estranhos.length > 0) {
        const partes = [
          faltando.length > 0 && `faltando: ${faltando.join(', ')}`,
          estranhos.length > 0 && `não são status de tarefa: ${estranhos.join(', ')}`,
        ].filter(Boolean)
        throw new HttpException(`A ordem precisa ter todos os status de tarefa, sem repetição (${partes.join('; ')})`, HttpStatus.BAD_REQUEST)
      }
      for (const [posicao, id] of ids.entries()) {
        await tx.statusTarefa.update({ where: { id }, data: { ordem: posicao + 1 } })
      }
      return tx.statusTarefa.findMany({ orderBy: { ordem: 'asc' } })
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
