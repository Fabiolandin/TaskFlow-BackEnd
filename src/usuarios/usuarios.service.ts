import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { UsuarioAutenticado } from '../auth/usuario-atual.decorator';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { PrismaService } from 'src/database/prisma.service';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

@Injectable()
export class UsuariosService {
  @Inject()
  private readonly prisma: PrismaService

  //RF-82: só admin cria usuário
  async create(createUsuarioDto: CreateUsuarioDto, eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw new ForbiddenException('Apenas administradores podem criar usuários');
    //Pegando a senha e criando Hash
    const senhaHash = bcrypt.hashSync(createUsuarioDto.senha, 10);

    // se a senha vem dps do spread('...createUsuarioDTO') ele sobrescreve o objeto literal
    const usuario = await this.prisma.usuarios.create({
      data: {
        ...createUsuarioDto,
        senha: senhaHash,
      },
    });

    const { senha, senhaAlteradaEm, ...usuarioSemSenha } = usuario;
    return usuarioSemSenha;
  }

  async findAll() {
    return this.prisma.usuarios.findMany({
      select: {
        id: true,
        nome: true,
        email: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
      }
    });
  }

  async findOne(id: number) {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        email: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    if (!usuario) {
      throw new NotFoundException(`Usuario ${id} não encontrado`)
    }
    
    return usuario;
  }

  //RF-82: admin edita qualquer um; comum, só a própria conta e sem mexer no papel.
  //RF-91: o último admin não perde o papel, nem com pedidos ao mesmo tempo.
  //RF-92/RF-93: trocar a senha grava a data (derruba os tokens); a própria senha pede a atual
  async update(id: number, updateUsuarioDto: UpdateUsuarioDto, eu: UsuarioAutenticado) {
    if (!eu.isAdmin && id !== eu.id) throw new ForbiddenException('Você só pode editar a própria conta');
    if (!eu.isAdmin && updateUsuarioDto.isAdmin !== undefined) throw new ForbiddenException('Apenas administradores podem alterar o papel');
    const { senhaAtual, ...data } = updateUsuarioDto;
    const dados: Prisma.UsuariosUpdateInput = { ...data };

    if (data.senha !== undefined) {
      if (id === eu.id) {
        if (!senhaAtual) throw new BadRequestException('Informe a senha atual para trocar a senha');
        const atual = await this.prisma.usuarios.findUnique({ where: { id }, select: { senha: true } });
        if (!atual || !(await bcrypt.compare(senhaAtual, atual.senha))) throw new BadRequestException('Senha atual incorreta');
      }
      dados.senha = bcrypt.hashSync(data.senha, 10);
      dados.senhaAlteradaEm = new Date();
    }

    //a contagem de admins é feita depois da gravação, na mesma transação: se zerou, desfaz
    const usuario = await this.prisma.$transaction(async (tx) => {
      const gravado = await tx.usuarios.update({ where: { id }, data: dados });
      if (data.isAdmin === false) await this.exigirUmAdmin(tx);
      return gravado;
    });

    //sem a senha e sem a versão dela
    const { senha, senhaAlteradaEm, ...usuarioSemSenha } = usuario;
    return usuarioSemSenha;
  }

  //RF-81/RF-91: chamada dentro da transação, depois da escrita que poderia tirar o último admin
  private async exigirUmAdmin(tx: Prisma.TransactionClient) {
    if ((await tx.usuarios.count({ where: { isAdmin: true } })) < 1) {
      throw new ConflictException('É preciso ter pelo menos um administrador');
    }
  }

  //RF-82: só admin exclui, e nunca a própria conta (assim sempre sobra um admin)
  async remove(id: number, eu: UsuarioAutenticado) {
    if (!eu.isAdmin) throw new ForbiddenException('Apenas administradores podem excluir usuários');
    if (id === eu.id) throw new BadRequestException('Você não pode excluir a própria conta');
    // RF-30: membro de projeto não é excluído, e o vínculo não é desfeito junto (SPEC-013, D-1)
    const projetos = await this.prisma.usuariosProjetos.count({ where: { idUsuario: id } });
    if (projetos > 0) {
      throw new HttpException(
        `O usuário é membro de ${projetos} projeto(s): remova-o dos projetos antes de excluí-lo`,
        HttpStatus.CONFLICT,
      );
    }

    //RF-91: excluir um admin não pode zerar os admins, nem com pedidos ao mesmo tempo
    const usuario = await this.prisma.$transaction(async (tx) => {
      const excluido = await tx.usuarios.delete({ where: { id } });
      if (excluido.isAdmin) await this.exigirUmAdmin(tx);
      return excluido;
    });

    const { senha, senhaAlteradaEm, ...usuarioSemSenha } = usuario;
    return usuarioSemSenha;
  }
}
