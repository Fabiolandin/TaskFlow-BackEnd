import { Inject, Injectable } from '@nestjs/common';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class UsuariosService {
  @Inject()
  private readonly prisma: PrismaService

  create(createUsuarioDto: CreateUsuarioDto) {
    return this.prisma.usuarios.create({
      data: createUsuarioDto,
    });
  }

  async findAll() {
    return this.prisma.usuarios.findMany();
  }

  findOne(id: number) {
    return this.prisma.usuarios.findUnique({
      where: { id },
    });
  }

  update(id: number, updateUsuarioDto: UpdateUsuarioDto) {
    return this.prisma.usuarios.update({
      where: { id },
      data: updateUsuarioDto,
    });
  }

  remove(id: number) {
    return this.prisma.usuarios.delete({
      where: { id },
    });
  }
}
