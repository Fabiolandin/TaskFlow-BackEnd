import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { UsuarioAutenticado } from '../auth/usuario-atual.decorator';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { PrismaService } from 'src/database/prisma.service';
import * as bcrypt from 'bcrypt';

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

    const { senha, ...usuarioSemSenha } = usuario;
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
  //RF-81: o último admin não perde o papel
  async update(id: number, updateUsuarioDto: UpdateUsuarioDto, eu: UsuarioAutenticado) {
    if (!eu.isAdmin && id !== eu.id) throw new ForbiddenException('Você só pode editar a própria conta');
    if (!eu.isAdmin && updateUsuarioDto.isAdmin !== undefined) throw new ForbiddenException('Apenas administradores podem alterar o papel');
    const data = { ...updateUsuarioDto };

    if (data.isAdmin === false) {
      const alvo = await this.prisma.usuarios.findUnique({ where: { id }, select: { isAdmin: true } });
      if (alvo?.isAdmin && (await this.prisma.usuarios.count({ where: { isAdmin: true } })) <= 1) {
        throw new ConflictException('É preciso ter pelo menos um administrador');
      }
    }

    // Verifica se a senha está presente no objeto de atualização e cria o hash se necessário
    if (data.senha) {
      data.senha = bcrypt.hashSync(data.senha, 10);
    }

    const usuario = await this.prisma.usuarios.update({
      where: { id },
      data,
    });

    //return de usuaruio sem a senha
    const { senha, ...usuarioSemSenha } = usuario;
    return usuarioSemSenha;
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

    const usuario = await this.prisma.usuarios.delete({
      where: { id },
    });

    const { senha, ...usuarioSemSenha } = usuario;
    return usuarioSemSenha;
  }
}
