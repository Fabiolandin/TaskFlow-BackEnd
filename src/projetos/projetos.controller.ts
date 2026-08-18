import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ProjetosService } from './projetos.service';
import { CreateProjetoDto } from './dto/create-projeto.dto';
import { UpdateProjetoDto } from './dto/update-projeto.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Projetos } from '@prisma/client';

@ApiTags('Projetos')
@Controller('projetos')
export class ProjetosController {
  constructor(private readonly projetosService: ProjetosService) {}

  @Post()
  @ApiOperation({ summary: 'Criar um novo projeto' })
  create(
    @Body() createProjetoDto: CreateProjetoDto
  ): Promise<Projetos> {
    return this.projetosService.create(createProjetoDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos os projetos' })
  findAll() {
    return this.projetosService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter um projeto pelo ID' })
  findOne(@Param('id') id: string) {
    return this.projetosService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar um projeto pelo ID' })
  update(@Param('id') id: string, @Body() updateProjetoDto: UpdateProjetoDto) 
  : Promise<Projetos> {
    return this.projetosService.update(+id, updateProjetoDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deletar um projeto pelo ID' })
  remove(@Param('id') id: string) {
    return this.projetosService.remove(+id);
  }
}
