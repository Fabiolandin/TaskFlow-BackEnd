import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembrosService } from './membros.service';
import { CreateMembroDto } from './dto/create-membro.dto';

@ApiTags('Membros')
@Controller('projetos/:idProjeto/membros')
export class MembrosController {
  constructor(private readonly membrosService: MembrosService) {}

  @Get()
  @ApiOperation({ summary: 'Listar os membros de um projeto' })
  findAll(@Param('idProjeto') idProjeto: string) {
    return this.membrosService.findAll(+idProjeto);
  }

  @Post()
  @ApiOperation({ summary: 'Adicionar um membro ao projeto' })
  create(@Param('idProjeto') idProjeto: string, @Body() createMembroDto: CreateMembroDto) {
    return this.membrosService.create(+idProjeto, createMembroDto.idUsuario);
  }

  @Delete(':idUsuario')
  @ApiOperation({ summary: 'Remover um membro do projeto' })
  remove(@Param('idProjeto') idProjeto: string, @Param('idUsuario') idUsuario: string) {
    return this.membrosService.remove(+idProjeto, +idUsuario);
  }
}
