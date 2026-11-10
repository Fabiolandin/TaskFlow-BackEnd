import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseIntPipe } from '@nestjs/common';
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

  // RF-54: só leitura; não há rota de escrita de atividade (RF-53). O id nasce validado (400, nunca 500)
  @Get(':id/atividades')
  @ApiOperation({ summary: 'Histórico de alterações de uma tarefa' })
  findAtividades(@Param('id', ParseIntPipe) id: number) {
    return this.tarefasService.findAtividades(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar uma tarefa por ID' })
  update(
    @Param('id') id: string,
    @Body() updateTarefaDto: UpdateTarefaDto,
    @UsuarioAtual() usuario: UsuarioAutenticado
  ) {
    // RF-08/RF-53: o autor da atividade é o usuário do token
    return this.tarefasService.update(+id, updateTarefaDto, usuario.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deletar uma tarefa por ID' })
  remove(@Param('id') id: string) {
    return this.tarefasService.remove(+id);
  }
}
