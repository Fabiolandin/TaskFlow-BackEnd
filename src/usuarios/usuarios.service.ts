import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { PrismaService } from 'src/database/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsuariosService {
  @Inject()
  private readonly prisma: PrismaService

  async create(createUsuarioDto: CreateUsuarioDto) {
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
        createdAt: true,
        updatedAt: true,
      }
    });

    if (!usuario) {
      throw new NotFoundException(`Usuario ${id} não encontrado`)
    }
    
    return usuario;
  }

  async update(id: number, updateUsuarioDto: UpdateUsuarioDto) {
    const data = { ...updateUsuarioDto };

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

  async remove(id: number) {
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
