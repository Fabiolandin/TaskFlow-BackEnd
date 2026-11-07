import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ComentariostarefasService } from './comentariostarefas.service';
import { CreateComentariostarefaDto } from './dto/create-comentariostarefa.dto';
import { UpdateComentariostarefaDto } from './dto/update-comentariostarefa.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsuarioAtual } from 'src/auth/usuario-atual.decorator';
import type { UsuarioAutenticado } from 'src/auth/usuario-atual.decorator';

@ApiTags('Comentário das Tarefas')
@Controller('comentariostarefas')
export class ComentariostarefasController {
  constructor(private readonly comentariostarefasService: ComentariostarefasService) { }

  @Post()
  @ApiOperation({ summary: 'Criar um novo comentário de tarefa' })
  create(
    @Body() createComentariostarefaDto: CreateComentariostarefaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado
  ) {
    return this.comentariostarefasService.create(createComentariostarefaDto, usuario.id);
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
  update(
    @Param('id') id: string,
    @Body() updateComentariostarefaDto: UpdateComentariostarefaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado
  ) {
    return this.comentariostarefasService.update(+id, updateComentariostarefaDto, usuario.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deletar um comentário de tarefa pelo ID' })
  remove(@Param('id') id: string) {
    return this.comentariostarefasService.remove(+id);
  }
}
