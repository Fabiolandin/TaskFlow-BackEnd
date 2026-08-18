import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { LabelsService } from './labels.service';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Labels } from '@prisma/client';

@ApiTags('Labels')
@Controller('labels')
export class LabelsController {
  constructor(private readonly labelsService: LabelsService) {}

  @Post()
  @ApiOperation({ summary: 'Criar uma nova label'})
  create(
    @Body() createLabelDto: CreateLabelDto
  ): Promise<Labels> {
    return this.labelsService.create(createLabelDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todas as labels'})
  findAll() {
    return this.labelsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter uma label por ID'})
  findOne(@Param('id') id: string) {
    return this.labelsService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar uma label pelo ID'})
  update(@Param('id') id: string, @Body() updateLabelDto: UpdateLabelDto)
  : Promise <Labels> {
    return this.labelsService.update(+id, updateLabelDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.labelsService.remove(+id);
  }
}
