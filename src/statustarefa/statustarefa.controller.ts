import { Controller, Get, Post, Body, Patch, Param, Delete, Put } from '@nestjs/common';
import { StatustarefaService } from './statustarefa.service';
import { CreateStatustarefaDto } from './dto/create-statustarefa.dto';
import { UpdateStatustarefaDto } from './dto/update-statustarefa.dto';
import { ReordenarStatustarefaDto } from './dto/reordenar-statustarefa.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatusTarefa } from '@prisma/client';

@ApiTags('Status de tarefa')
@Controller('statustarefa')
export class StatustarefaController {
  constructor(private readonly statustarefaService: StatustarefaService) {}

  @Post()
  @ApiOperation({ summary: 'Criar um status de tarefa'})
  create(
    @Body() createStatustarefaDto: CreateStatustarefaDto
  ): Promise<StatusTarefa> {
    return this.statustarefaService.create(createStatustarefaDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar os status de tarefa, pela ordem'})
  findAll() {
    return this.statustarefaService.findAll();
  }

  // RF-62: declarada antes das rotas com :id
  @Put('ordem')
  @ApiOperation({ summary: 'Reordenar os status de tarefa (lista inteira de ids)'})
  reordenar(@Body() dto: ReordenarStatustarefaDto) {
    return this.statustarefaService.reordenar(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter um status de tarefa por ID'})
  findOne(@Param('id') id: string) {
    return this.statustarefaService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar um status de tarefa pelo ID'})
  update(@Param('id') id: string, @Body() updateStatustarefaDto: UpdateStatustarefaDto)
  : Promise<StatusTarefa> {
    return this.statustarefaService.update(+id, updateStatustarefaDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover um status de tarefa pelo ID'})
  remove(@Param('id') id: string) {
    return this.statustarefaService.remove(+id);
  }
}
