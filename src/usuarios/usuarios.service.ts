import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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
      const senhaHash = bcrypt.hashSync(data.senha, 10);
      data.senha = senhaHash;
    }

    const usuario = await this.prisma.usuarios.update({
      where: { id },
      data,
    });

    //return de usuaruio sem a senha
    const { senha, ...usuarioSemSenha } = usuario;
    return usuarioSemSenha;
  }

  remove(id: number) {
    return this.prisma.usuarios.delete({
      where: { id },
    });
  }
}
