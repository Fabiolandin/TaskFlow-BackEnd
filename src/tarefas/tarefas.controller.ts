import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { TarefasService } from './tarefas.service';
import { CreateTarefaDto } from './dto/create-tarefa.dto';
import { UpdateTarefaDto } from './dto/update-tarefa.dto';
import { QueryTarefaDto } from './dto/query-tarefa.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsuarioAtual } from 'src/auth/usuario-atual.decorator';
import type { UsuarioAutenticado } from 'src/auth/usuario-atual.decorator';

@ApiTags('Tarefas')
@Controller('tarefas')
export class TarefasController {
  constructor(private readonly tarefasService: TarefasService) { }

  @Post()
  @ApiOperation({ summary: 'Criar uma nova tarefa' })
  create(
    @Body() createTarefaDto: CreateTarefaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado
  ) {
    return this.tarefasService.create(createTarefaDto, usuario.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar tarefas (paginado e filtrável)' })
  findAll(@Query() query: QueryTarefaDto) {
    return this.tarefasService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter uma tarefa por ID' })
  findOne(@Param('id') id: string) {
    return this.tarefasService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar uma tarefa por ID' })
  update(@Param('id') id: string, @Body() updateTarefaDto: UpdateTarefaDto) {
    return this.tarefasService.update(+id, updateTarefaDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deletar uma tarefa por ID' })
  remove(@Param('id') id: string) {
    return this.tarefasService.remove(+id);
  }
}
