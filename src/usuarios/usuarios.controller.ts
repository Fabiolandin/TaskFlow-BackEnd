import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Usuarios } from '@prisma/client';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/usuario-atual.decorator';

@ApiTags('Usuarios')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  //cadastro fechado: exige login e admin (RF-06, RF-82)
  @Post()
  @ApiOperation({ summary: 'Criar um novo usuario (só admin)' })
  create(
    @Body() createUsuarioDto: CreateUsuarioDto,
    @UsuarioAtual() eu: UsuarioAutenticado,
  ): Promise<Omit<Usuarios, 'senha' | 'senhaAlteradaEm'>> {
    return this.usuariosService.create(createUsuarioDto, eu);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos os usuarios'})
  findAll() {
    return this.usuariosService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usuariosService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUsuarioDto: UpdateUsuarioDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.usuariosService.update(+id, updateUsuarioDto, eu);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.usuariosService.remove(+id, eu);
  }
}
