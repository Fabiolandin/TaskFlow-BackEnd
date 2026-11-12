import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStatusprojetoDto } from './dto/create-statusprojeto.dto';
import { UpdateStatusprojetoDto } from './dto/update-statusprojeto.dto';
import { ReordenarStatusprojetoDto } from './dto/reordenar-statusprojeto.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class StatusprojetoService {
  @Inject()
  private readonly prisma: PrismaService

  // RF-21: sem ordem, vai para o fim (maior ordem + 1; 1 no cadastro vazio)
  async create(createStatusprojetoDto: CreateStatusprojetoDto) {
    const { ordem, ...resto } = createStatusprojetoDto
    const fim = ordem ?? ((await this.prisma.statusProjeto.aggregate({ _max: { ordem: true } }))._max.ordem ?? 0) + 1
    return this.prisma.statusProjeto.create({
      data: { ...resto, ordem: fim }
    })
  }

  // RF-62: a lista inteira, na ordem nova; grava ordem = posição numa transação, ou nada
  reordenar({ ids }: ReordenarStatusprojetoDto) {
    return this.prisma.$transaction(async (tx) => {
      const existentes = (await tx.statusProjeto.findMany({ select: { id: true } })).map((s) => s.id)
      const faltando = existentes.filter((id) => !ids.includes(id))
      const estranhos = ids.filter((id) => !existentes.includes(id))
      if (faltando.length > 0 || estranhos.length > 0) {
        const partes = [
          faltando.length > 0 && `faltando: ${faltando.join(', ')}`,
          estranhos.length > 0 && `não são status de projeto: ${estranhos.join(', ')}`,
        ].filter(Boolean)
        throw new HttpException(`A ordem precisa ter todos os status de projeto, sem repetição (${partes.join('; ')})`, HttpStatus.BAD_REQUEST)
      }
      for (const [posicao, id] of ids.entries()) {
        await tx.statusProjeto.update({ where: { id }, data: { ordem: posicao + 1 } })
      }
      return tx.statusProjeto.findMany({ orderBy: { ordem: 'asc' } })
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
