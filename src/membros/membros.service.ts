import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';

// Campos de usuário expostos como membro. Nunca `senha` (RF-03).
export const SELECT_MEMBRO = { id: true, nome: true, email: true } as const;

// Para `include` nas consultas de projeto: os vínculos, em ordem de entrada, só com o usuário.
export const INCLUDE_MEMBROS = {
  select: { usuario: { select: SELECT_MEMBRO } },
  orderBy: { id: 'asc' },
} as const;

// Troca `usuariosProjetos` por `membros: [{ id, nome, email }]` na resposta do projeto.
export function comMembros<T extends { usuariosProjetos: { usuario: unknown }[] }>(projeto: T) {
  const { usuariosProjetos, ...resto } = projeto;
  return { ...resto, membros: usuariosProjetos.map((v) => v.usuario) };
}

@Injectable()
export class MembrosService {
  @Inject()
  private readonly prisma: PrismaService

  async findAll(idProjeto: number) {
    await this.garantirProjeto(idProjeto);
    const vinculos = await this.prisma.usuariosProjetos.findMany({
      where: { idProjeto },
      ...INCLUDE_MEMBROS,
    });
    return vinculos.map((v) => v.usuario);
  }

  // RF-25: a associação é única por par usuário-projeto.
  async create(idProjeto: number, idUsuario: number) {
    await this.garantirProjeto(idProjeto);
    const usuario = await this.prisma.usuarios.findUnique({
      where: { id: idUsuario },
      select: SELECT_MEMBRO,
    });
    if (!usuario) {
      throw new NotFoundException(`Usuario ${idUsuario} não encontrado`);
    }

    const existente = await this.prisma.usuariosProjetos.findUnique({
      where: { idUsuario_idProjeto: { idUsuario, idProjeto } },
    });
    if (existente) {
      throw new HttpException('O usuário já é membro deste projeto', HttpStatus.CONFLICT);
    }

    await this.prisma.usuariosProjetos.create({ data: { idUsuario, idProjeto } });
    return usuario;
  }

  // RF-27: não sai do projeto quem é responsável por tarefa dele.
  async remove(idProjeto: number, idUsuario: number) {
    const vinculo = await this.prisma.usuariosProjetos.findUnique({
      where: { idUsuario_idProjeto: { idUsuario, idProjeto } },
      include: { usuario: { select: SELECT_MEMBRO } },
    });
    if (!vinculo) {
      throw new NotFoundException(`Usuario ${idUsuario} não é membro do projeto ${idProjeto}`);
    }

    const tarefas = await this.prisma.tarefas.count({
      where: { idProjeto, idUsuarioResponsavel: idUsuario },
    });
    if (tarefas > 0) {
      throw new HttpException(
        `O usuário é responsável por ${tarefas} tarefa(s) deste projeto: troque o responsável antes de removê-lo`,
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.usuariosProjetos.delete({ where: { id: vinculo.id } });
    return vinculo.usuario;
  }

  private async garantirProjeto(idProjeto: number) {
    const projeto = await this.prisma.projetos.findUnique({
      where: { id: idProjeto },
      select: { id: true },
    });
    if (!projeto) {
      throw new NotFoundException(`Projeto ${idProjeto} não encontrado`);
    }
  }
}
