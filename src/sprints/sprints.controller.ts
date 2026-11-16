import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsuarioAtual, type UsuarioAutenticado } from '../auth/usuario-atual.decorator';
import { SprintsService } from './sprints.service';
import { AcompanhamentoDto, CreateItemDto, CreateSprintDto, FecharSprintDto, QueryCronogramaDto, ReordenarFilaDto, UpdateItemDto, UpdateSprintDto } from './dto/sprint.dto';

// SPEC-024: ler é de qualquer usuário logado; escrever é só do admin (checado no service)

@ApiTags('Sprints')
@Controller('sprints')
export class SprintsController {
  constructor(private readonly sprints: SprintsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar sprints, mais recente primeiro (RF-109)' })
  listar() {
    return this.sprints.listar();
  }

  @Get(':id')
  obter(@Param('id', ParseIntPipe) id: number) {
    return this.sprints.obter(id);
  }

  @Get(':id/planejamento')
  @ApiOperation({ summary: 'Filas por dev, ocupação, previsto, projetado e transbordo (RF-115)' })
  planejamento(@Param('id', ParseIntPipe) id: number) {
    return this.sprints.planejamento(id);
  }

  @Get(':id/cronograma')
  @ApiOperation({ summary: 'Cronograma: números, status, atraso e evolução (RF-126)' })
  cronograma(@Param('id', ParseIntPipe) id: number, @Query() q: QueryCronogramaDto) {
    return this.sprints.cronograma(id, q);
  }

  @Post()
  criar(@Body() dto: CreateSprintDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.sprints.criar(dto, eu);
  }

  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSprintDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.sprints.editar(id, dto, eu);
  }

  @Delete(':id')
  excluir(@Param('id', ParseIntPipe) id: number, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.sprints.excluir(id, eu);
  }

  @Post(':id/ativar')
  @ApiOperation({ summary: 'Ativar: congela a linha de base e grava o transbordo (RF-114, RF-118)' })
  ativar(@Param('id', ParseIntPipe) id: number, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.sprints.ativar(id, eu);
  }

  @Get(':id/fechamento')
  @ApiOperation({ summary: 'Tarefas não concluídas e a próxima sprint, antes de fechar (RF-136)' })
  previaFechamento(@Param('id', ParseIntPipe) id: number) {
    return this.sprints.previaFechamento(id);
  }

  @Post(':id/fechar')
  @ApiOperation({ summary: 'Fechar: move para a próxima ou devolve ao backlog (RF-137)' })
  fechar(@Param('id', ParseIntPipe) id: number, @Body() dto: FecharSprintDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.sprints.fechar(id, dto, eu);
  }

  @Post(':id/itens')
  @ApiOperation({ summary: 'Alocar tarefa ou criar linha avulsa na fila de um dev (RF-110, RF-111)' })
  criarItem(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateItemDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.sprints.criarItem(id, dto, eu);
  }

  @Put(':id/fila/:idUsuario')
  @ApiOperation({ summary: 'Reordenar a fila inteira de um dev (RF-110)' })
  reordenar(
    @Param('id', ParseIntPipe) id: number,
    @Param('idUsuario', ParseIntPipe) idUsuario: number,
    @Body() dto: ReordenarFilaDto,
    @UsuarioAtual() eu: UsuarioAutenticado,
  ) {
    return this.sprints.reordenar(id, idUsuario, dto.ids, eu);
  }
}

@ApiTags('Sprints')
@Controller('itens')
export class ItensController {
  constructor(private readonly sprints: SprintsService) {}

  @Patch(':id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateItemDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.sprints.editarItem(id, dto, eu);
  }

  @Patch(':id/acompanhamento')
  @ApiOperation({ summary: 'Evolução, bloqueio, observação e entrega real do item (RF-120)' })
  acompanhamento(@Param('id', ParseIntPipe) id: number, @Body() dto: AcompanhamentoDto, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.sprints.acompanhamento(id, dto, eu);
  }

  @Delete(':id')
  @HttpCode(204)
  excluir(@Param('id', ParseIntPipe) id: number, @UsuarioAtual() eu: UsuarioAutenticado) {
    return this.sprints.excluirItem(id, eu);
  }
}
