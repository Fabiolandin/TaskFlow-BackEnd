import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { StatusprojetoService } from './statusprojeto.service';
import { CreateStatusprojetoDto } from './dto/create-statusprojeto.dto';
import { UpdateStatusprojetoDto } from './dto/update-statusprojeto.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatusProjeto } from '@prisma/client';

@ApiTags('Status de projeto')
@Controller('statusprojeto')
export class StatusprojetoController {
  constructor(private readonly statusprojetoService: StatusprojetoService) {}

  @Post()
  @ApiOperation({ summary: 'Criar um status de projeto'})
  create(
    @Body() createStatusprojetoDto: CreateStatusprojetoDto
  ): Promise<StatusProjeto> {
    return this.statusprojetoService.create(createStatusprojetoDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar os status de projeto, pela ordem'})
  findAll() {
    return this.statusprojetoService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter um status de projeto por ID'})
  findOne(@Param('id') id: string) {
    return this.statusprojetoService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar um status de projeto pelo ID'})
  update(@Param('id') id: string, @Body() updateStatusprojetoDto: UpdateStatusprojetoDto)
  : Promise<StatusProjeto> {
    return this.statusprojetoService.update(+id, updateStatusprojetoDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover um status de projeto pelo ID'})
  remove(@Param('id') id: string) {
    return this.statusprojetoService.remove(+id);
  }
}
