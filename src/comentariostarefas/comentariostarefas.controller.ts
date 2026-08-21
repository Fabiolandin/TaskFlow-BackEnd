import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ComentariostarefasService } from './comentariostarefas.service';
import { CreateComentariostarefaDto } from './dto/create-comentariostarefa.dto';
import { UpdateComentariostarefaDto } from './dto/update-comentariostarefa.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComentariosTarefas } from '@prisma/client';

@ApiTags('Comentário das Tarefas')
@Controller('comentariostarefas')
export class ComentariostarefasController {
  constructor(private readonly comentariostarefasService: ComentariostarefasService) { }

  @Post()
  @ApiOperation({ summary: 'Criar um novo comentário de tarefa' })
  create(
    @Body() createComentariostarefaDto: CreateComentariostarefaDto
  ): Promise<ComentariosTarefas> {
    return this.comentariostarefasService.create(createComentariostarefaDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos os comentários de tarefa' })
  findAll() {
    return this.comentariostarefasService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter um comentário de tarefa pelo ID' })
  findOne(@Param('id') id: string) {
    return this.comentariostarefasService.findOne(+id);
  }

  @Get('tarefas/:id')
  @ApiOperation({ summary: 'Obter comentários de tarefa pela ID da tarefa' })
  findByTarefa(@Param('id') id: string) {
    return this.comentariostarefasService.findByTarefa(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar um comentário de tarefa pelo ID' })
  update(@Param('id') id: string, @Body() updateComentariostarefaDto: UpdateComentariostarefaDto)
    : Promise<ComentariosTarefas> {
    return this.comentariostarefasService.update(+id, updateComentariostarefaDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deletar um comentário de tarefa pelo ID' })
  remove(@Param('id') id: string) {
    return this.comentariostarefasService.remove(+id);
  }
}
