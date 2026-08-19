import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { TarefasService } from './tarefas.service';
import { CreateTarefaDto } from './dto/create-tarefa.dto';
import { UpdateTarefaDto } from './dto/update-tarefa.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Tarefas } from '@prisma/client';

@ApiTags('Tarefas')
@Controller('tarefas')
export class TarefasController {
  constructor(private readonly tarefasService: TarefasService) { }

  @Post()
  @ApiOperation({ summary: 'Criar uma nova tarefa' })
  create(
    @Body() createTarefaDto: CreateTarefaDto
  ): Promise<Tarefas> {
    return this.tarefasService.create(createTarefaDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todas as tarefas' })
  findAll() {
    return this.tarefasService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter uma tarefa por ID' })
  findOne(@Param('id') id: string) {
    return this.tarefasService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar uma tarefa por ID' })
  update(@Param('id') id: string, @Body() updateTarefaDto: UpdateTarefaDto)
    : Promise<Tarefas> {
    return this.tarefasService.update(+id, updateTarefaDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deletar uma tarefa por ID' })
  remove(@Param('id') id: string) {
    return this.tarefasService.remove(+id);
  }
}
