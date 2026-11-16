import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/usuario-atual.decorator';
import { ApontamentosService } from './apontamentos.service';
import { ConverterApontamentoDto, CreateApontamentoDto, QueryApontamentosDto, QueryItensApontaveisDto, UpdateApontamentoDto } from './dto/apontamento.dto';

// SPEC-026: cada dev aponta e vê só o que é seu; admin vê e corrige de qualquer um (RF-129)
@ApiTags('Apontamentos')
@Controller('apontamentos')
export class ApontamentosController {
  constructor(private readonly apontamentos: ApontamentosService) {}

  @Get()
  @ApiOperation({ summary: 'Apontamentos do dia de um dev (RF-131)' })
  listar(@Query() q: QueryApontamentosDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.apontamentos.listar(eu, q.data, q.idUsuario);
  }

  @Get('itens')
  @ApiOperation({ summary: 'Itens que o dev pode apontar na data (RF-131)' })
  itens(@Query() q: QueryItensApontaveisDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.apontamentos.itens(eu, q.data, q.idUsuario, q.todas ?? false);
  }

  @Post()
  criar(@Body() dto: CreateApontamentoDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.apontamentos.criar(eu, dto);
  }

  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateApontamentoDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.apontamentos.editar(eu, id, dto);
  }

  @Delete(':id')
  excluir(@Param('id', ParseIntPipe) id: number, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.apontamentos.excluir(eu, id);
  }

  @Post(':id/converter')
  @ApiOperation({ summary: 'Converter apontamento sem tarefa em tarefa não prevista (RF-132)' })
  converter(@Param('id', ParseIntPipe) id: number, @Body() dto: ConverterApontamentoDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.apontamentos.converter(eu, id, dto.idProjeto);
  }
}
