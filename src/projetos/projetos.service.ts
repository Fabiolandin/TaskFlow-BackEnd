import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateProjetoDto } from './dto/create-projeto.dto';
import { UpdateProjetoDto } from './dto/update-projeto.dto';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { INCLUDE_MEMBROS, comMembros } from 'src/membros/membros.service';
import { QueryProjetoDto } from './dto/query-projeto.dto';
import { idsComNome } from 'src/database/busca';

// RF-51: um só formato de projeto nas 4 rotas (status, membros e progresso)
const INCLUDE_PROJETO = { status: true, usuariosProjetos: INCLUDE_MEMBROS } as const satisfies Prisma.ProjetosInclude;
type ProjetoBruto = Prisma.ProjetosGetPayload<{ include: typeof INCLUDE_PROJETO }>;

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
      include: INCLUDE_PROJETO,
    });
    return (await this.formatar([projeto]))[0];
  }

  async findAll({ page, limit, busca }: QueryProjetoDto) {
    // RF-56: nome contém o texto; vazia equivale a sem busca
    const where: Prisma.ProjetosWhereInput = busca ? { id: { in: await idsComNome(this.prisma, 'Projetos', busca) } } : {}
    const [data, total] = await Promise.all([
      this.prisma.projetos.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { id: 'asc' },
        include: INCLUDE_PROJETO,
      }),
      this.prisma.projetos.count({ where }),
    ])
    return { data: await this.formatar(data), total, page, totalPages: Math.ceil(total / limit) }
  }

  async findOne(id: number) {
    const projeto = await this.prisma.projetos.findUnique({
      where: { id },
      include: INCLUDE_PROJETO,
    });

    if (!projeto) {
      throw new NotFoundException(`Projeto ${id} não encontrado`)
    }

    return (await this.formatar([projeto]))[0];
  }

  // RF-51: o PATCH responde no formato único, já com os valores gravados
  async update(id: number, updateProjetoDto: UpdateProjetoDto) {
    const projeto = await this.prisma.projetos.update({
      where: { id },
      data: updateProjetoDto,
      include: INCLUDE_PROJETO,
    });
    return (await this.formatar([projeto]))[0];
  }

  // RF-50: com tarefas, 409 próprio e nada apagado; sem tarefas, vínculos de membro e projeto juntos.
  // Uma tarefa criada entre a contagem e o delete cai no P2003 (409 do RNF-01) com rollback.
  remove(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const projeto = await tx.projetos.findUnique({ where: { id }, select: { id: true } });
      if (!projeto) {
        throw new NotFoundException(`Projeto ${id} não encontrado`);
      }
      const tarefas = await tx.tarefas.count({ where: { idProjeto: id } });
      if (tarefas > 0) {
        throw new HttpException(
          `Projeto em uso: tem ${tarefas} tarefa(s). Exclua ou mova as tarefas antes de excluir o projeto.`,
          HttpStatus.CONFLICT,
        );
      }
      await tx.usuariosProjetos.deleteMany({ where: { idProjeto: id } });
      return tx.projetos.delete({ where: { id } });
    });
  }

  // RF-49/RF-51: membros achatados + progresso por 2 groupBy restritos aos ids pedidos (D-5);
  // concluída = status isFinal, a regra do Dashboard (RF-39), nunca o nome.
  private async formatar(projetos: ProjetoBruto[]) {
    const ids = projetos.map((p) => p.id);
    const [totais, concluidas] = ids.length
      ? await Promise.all([
          this.prisma.tarefas.groupBy({ by: ['idProjeto'], where: { idProjeto: { in: ids } }, _count: { _all: true } }),
          this.prisma.tarefas.groupBy({ by: ['idProjeto'], where: { idProjeto: { in: ids }, status: { isFinal: true } }, _count: { _all: true } }),
        ])
      : [[], []];
    const totalDe = new Map(totais.map((g) => [g.idProjeto, g._count._all]));
    const concluidasDe = new Map(concluidas.map((g) => [g.idProjeto, g._count._all]));
    return projetos.map((p) => ({
      ...comMembros(p),
      progresso: { total: totalDe.get(p.id) ?? 0, concluidas: concluidasDe.get(p.id) ?? 0 },
    }));
  }
}
