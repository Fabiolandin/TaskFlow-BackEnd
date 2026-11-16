import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import type { UsuarioAutenticado } from '../auth/usuario-atual.decorator';
import { exigirAdminDoCalendario } from './admin';
import { CLIENTE_FERIADOS, type ClienteFeriados } from './cliente-feriados';
import { capacidadeDosDias, capacidadeTotal, dataValida, diasNoPeriodo, paraData, paraTexto, type Calendario } from './capacidade.logica';
import type { CreateJornadaDto, UpdateJornadaDto } from './dto/jornada.dto';
import type { CreateFeriadoDto, UpdateFeriadoDto } from './dto/feriado.dto';
import type { CreateAusenciaDto, QueryAusenciasDto, UpdateAusenciaDto } from './dto/ausencia.dto';
import type { QueryCapacidadeDto } from './dto/capacidade.dto';

//RF-106: período máximo da consulta de capacidade
const MAX_DIAS = 366;

//campos AAAA-MM-DD do DTO viram DateTime à meia-noite UTC (ponto 22 do tecnico.md)
const comDatas = (dto: object, campos: string[]): Record<string, unknown> => {
  const saida: Record<string, unknown> = { ...dto };
  for (const c of campos) if (typeof saida[c] === 'string') saida[c] = paraData(saida[c] as string);
  return saida;
};

const fimAntesDoInicio = () => new BadRequestException('A data de fim não pode ser anterior à de início');

// SPEC-023: jornadas (RF-101), feriados (RF-102, RF-103), ausências (RF-104) e capacidade (RF-105, RF-106)
@Injectable()
export class CalendarioService {
  @Inject()
  private readonly prisma: PrismaService;

  @Inject(CLIENTE_FERIADOS)
  private readonly clienteFeriados: ClienteFeriados;

  // ---------- jornadas ----------

  listarJornadas(idUsuario?: number) {
    return this.prisma.jornadas.findMany({ where: { idUsuario }, orderBy: [{ idUsuario: 'asc' }, { vigencia: 'asc' }] });
  }

  criarJornada(dto: CreateJornadaDto, eu: UsuarioAutenticado) {
    exigirAdminDoCalendario(eu);
    return this.prisma.jornadas.create({ data: comDatas(dto, ['vigencia']) as Prisma.JornadasUncheckedCreateInput });
  }

  editarJornada(id: number, dto: UpdateJornadaDto, eu: UsuarioAutenticado) {
    exigirAdminDoCalendario(eu);
    return this.prisma.jornadas.update({ where: { id }, data: comDatas(dto, ['vigencia']) });
  }

  excluirJornada(id: number, eu: UsuarioAutenticado) {
    exigirAdminDoCalendario(eu);
    return this.prisma.jornadas.delete({ where: { id } });
  }

  // ---------- feriados ----------

  listarFeriados(ano?: number) {
    const where = ano === undefined ? {} : { data: { gte: paraData(`${ano}-01-01`), lte: paraData(`${ano}-12-31`) } };
    return this.prisma.feriados.findMany({ where, orderBy: { data: 'asc' } });
  }

  criarFeriado(dto: CreateFeriadoDto, eu: UsuarioAutenticado) {
    exigirAdminDoCalendario(eu);
    return this.prisma.feriados.create({ data: comDatas(dto, ['data']) as Prisma.FeriadosCreateInput });
  }

  editarFeriado(id: number, dto: UpdateFeriadoDto, eu: UsuarioAutenticado) {
    exigirAdminDoCalendario(eu);
    return this.prisma.feriados.update({ where: { id }, data: comDatas(dto, ['data']) });
  }

  excluirFeriado(id: number, eu: UsuarioAutenticado) {
    exigirAdminDoCalendario(eu);
    return this.prisma.feriados.delete({ where: { id } });
  }

  //RF-103: lê a BrasilAPI; falha ou formato inesperado → 502 e nada gravado; data já cadastrada fica como está
  async importarFeriados(ano: number, eu: UsuarioAutenticado) {
    exigirAdminDoCalendario(eu);
    const falha = () => new HttpException(`Não foi possível importar os feriados de ${ano}`, HttpStatus.BAD_GATEWAY);

    let resposta: unknown;
    try {
      resposta = await this.clienteFeriados.buscar(ano);
    } catch {
      throw falha();
    }
    if (!Array.isArray(resposta)) throw falha();
    const feriados: { data: string; nome: string }[] = [];
    for (const item of resposta) {
      const { date, name } = (item ?? {}) as { date?: unknown; name?: unknown };
      if (!dataValida(date) || typeof name !== 'string' || !name.trim()) throw falha();
      feriados.push({ data: date, nome: name.trim().slice(0, 100) });
    }

    return this.prisma.$transaction(async (tx) => {
      const existentes = new Set(
        (await tx.feriados.findMany({ where: { data: { in: feriados.map((f) => paraData(f.data)) } }, select: { data: true } }))
          .map((f) => paraTexto(f.data)),
      );
      //a mesma data repetida na resposta conta uma vez
      const novos = feriados.filter((f, i) => !existentes.has(f.data) && feriados.findIndex((x) => x.data === f.data) === i);
      if (novos.length) await tx.feriados.createMany({ data: novos.map((f) => ({ data: paraData(f.data), nome: f.nome })) });
      return { criados: novos.length, ignorados: feriados.length - novos.length };
    });
  }

  // ---------- ausências ----------

  //as que tocam o período: começam até o fim e terminam a partir do início
  listarAusencias({ idUsuario, inicio, fim }: QueryAusenciasDto) {
    return this.prisma.ausencias.findMany({
      where: {
        idUsuario,
        ...(fim && { dataInicio: { lte: paraData(fim) } }),
        ...(inicio && { dataFim: { gte: paraData(inicio) } }),
      },
      orderBy: [{ dataInicio: 'asc' }, { id: 'asc' }],
    });
  }

  criarAusencia(dto: CreateAusenciaDto, eu: UsuarioAutenticado) {
    exigirAdminDoCalendario(eu);
    if (dto.dataFim < dto.dataInicio) throw fimAntesDoInicio();
    return this.prisma.ausencias.create({ data: comDatas(dto, ['dataInicio', 'dataFim']) as Prisma.AusenciasUncheckedCreateInput });
  }

  async editarAusencia(id: number, dto: UpdateAusenciaDto, eu: UsuarioAutenticado) {
    exigirAdminDoCalendario(eu);
    const atual = await this.prisma.ausencias.findUniqueOrThrow({ where: { id } });
    const inicio = dto.dataInicio ?? paraTexto(atual.dataInicio);
    const fim = dto.dataFim ?? paraTexto(atual.dataFim);
    if (fim < inicio) throw fimAntesDoInicio();
    return this.prisma.ausencias.update({ where: { id }, data: comDatas(dto, ['dataInicio', 'dataFim']) });
  }

  excluirAusencia(id: number, eu: UsuarioAutenticado) {
    exigirAdminDoCalendario(eu);
    return this.prisma.ausencias.delete({ where: { id } });
  }

  // ---------- capacidade ----------

  //lê do banco só o que o período precisa e entrega à função pura (RF-105); usado também pela fila (SPEC-024)
  async calendarioDe(idUsuario: number, inicio: string, fim: string): Promise<Calendario> {
    const [jornadas, feriados, ausencias] = await Promise.all([
      this.prisma.jornadas.findMany({ where: { idUsuario } }),
      this.prisma.feriados.findMany({ where: { data: { gte: paraData(inicio), lte: paraData(fim) } } }),
      this.prisma.ausencias.findMany({ where: { idUsuario, dataInicio: { lte: paraData(fim) }, dataFim: { gte: paraData(inicio) } } }),
    ]);
    return {
      jornadas: jornadas.map(({ vigencia, seg, ter, qua, qui, sex, sab, dom }) => ({ vigencia: paraTexto(vigencia), seg, ter, qua, qui, sex, sab, dom })),
      feriados: feriados.map((f) => ({ data: paraTexto(f.data), nome: f.nome, minutosDescontados: f.minutosDescontados })),
      ausencias: ausencias.map((a) => ({ tipo: a.tipo, dataInicio: paraTexto(a.dataInicio), dataFim: paraTexto(a.dataFim), minutosPorDia: a.minutosPorDia })),
    };
  }

  //RF-106
  async capacidade({ idUsuario, inicio, fim }: QueryCapacidadeDto) {
    if (fim < inicio) throw fimAntesDoInicio();
    if (diasNoPeriodo(inicio, fim) > MAX_DIAS) throw new BadRequestException(`O período pode ter no máximo ${MAX_DIAS} dias`);
    await this.prisma.usuarios.findUniqueOrThrow({ where: { id: idUsuario }, select: { id: true } });
    const dias = capacidadeDosDias(inicio, fim, await this.calendarioDe(idUsuario, inicio, fim));
    return { dias, total: capacidadeTotal(dias) };
  }
}
