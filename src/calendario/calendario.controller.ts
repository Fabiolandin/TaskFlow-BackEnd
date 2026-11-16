import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/usuario-atual.decorator';
import { CalendarioService } from './calendario.service';
import { CreateJornadaDto, UpdateJornadaDto } from './dto/jornada.dto';
import { CreateFeriadoDto, ImportarFeriadosDto, QueryFeriadosDto, UpdateFeriadoDto } from './dto/feriado.dto';
import { CreateAusenciaDto, QueryAusenciasDto, UpdateAusenciaDto } from './dto/ausencia.dto';
import { QueryCapacidadeDto, QueryJornadasDto } from './dto/capacidade.dto';

// SPEC-023: ler é de qualquer usuário logado; escrever é só do admin (checado no service)

@ApiTags('Calendário')
@Controller('jornadas')
export class JornadasController {
  constructor(private readonly calendario: CalendarioService) {}

  @Get()
  @ApiOperation({ summary: 'Listar jornadas (RF-101)' })
  listar(@Query() q: QueryJornadasDto) {
    return this.calendario.listarJornadas(q.idUsuario);
  }

  @Post()
  criar(@Body() dto: CreateJornadaDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.calendario.criarJornada(dto, eu);
  }

  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateJornadaDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.calendario.editarJornada(id, dto, eu);
  }

  @Delete(':id')
  excluir(@Param('id', ParseIntPipe) id: number, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.calendario.excluirJornada(id, eu);
  }
}

@ApiTags('Calendário')
@Controller('feriados')
export class FeriadosController {
  constructor(private readonly calendario: CalendarioService) {}

  @Get()
  @ApiOperation({ summary: 'Listar feriados, opcionalmente de um ano (RF-102)' })
  listar(@Query() q: QueryFeriadosDto) {
    return this.calendario.listarFeriados(q.ano);
  }

  @Post('importar')
  @ApiOperation({ summary: 'Importar feriados nacionais da BrasilAPI (RF-103)' })
  importar(@Body() dto: ImportarFeriadosDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.calendario.importarFeriados(dto.ano, eu);
  }

  @Post()
  criar(@Body() dto: CreateFeriadoDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.calendario.criarFeriado(dto, eu);
  }

  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFeriadoDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.calendario.editarFeriado(id, dto, eu);
  }

  @Delete(':id')
  excluir(@Param('id', ParseIntPipe) id: number, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.calendario.excluirFeriado(id, eu);
  }
}

@ApiTags('Calendário')
@Controller('ausencias')
export class AusenciasController {
  constructor(private readonly calendario: CalendarioService) {}

  @Get()
  @ApiOperation({ summary: 'Listar ausências que tocam o período (RF-104)' })
  listar(@Query() q: QueryAusenciasDto) {
    return this.calendario.listarAusencias(q);
  }

  @Post()
  criar(@Body() dto: CreateAusenciaDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.calendario.criarAusencia(dto, eu);
  }

  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAusenciaDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.calendario.editarAusencia(id, dto, eu);
  }

  @Delete(':id')
  excluir(@Param('id', ParseIntPipe) id: number, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.calendario.excluirAusencia(id, eu);
  }
}

@ApiTags('Calendário')
@Controller('capacidade')
export class CapacidadeController {
  constructor(private readonly calendario: CalendarioService) {}

  @Get()
  @ApiOperation({ summary: 'Capacidade de um dev por dia num período (RF-106)' })
  capacidade(@Query() q: QueryCapacidadeDto) {
    return this.calendario.capacidade(q);
  }
}
