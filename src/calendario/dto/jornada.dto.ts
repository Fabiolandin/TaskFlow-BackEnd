import { IsInt, Max, Min } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/swagger';
import { IsDataPura } from './data-pura';

const Minutos = () => (alvo: object, campo: string) => {
  IsInt()(alvo, campo);
  Min(0)(alvo, campo);
  Max(1440)(alvo, campo);
};

// RF-101: minutos de trabalho de cada dia da semana, inteiros de 0 a 1440
export class CreateJornadaDto {
  @IsInt()
  idUsuario: number;

  @IsDataPura()
  vigencia: string;

  @Minutos() seg: number;
  @Minutos() ter: number;
  @Minutos() qua: number;
  @Minutos() qui: number;
  @Minutos() sex: number;
  @Minutos() sab: number;
  @Minutos() dom: number;
}

//o dono da jornada não muda; vigência e minutos sim
export class UpdateJornadaDto extends PartialType(OmitType(CreateJornadaDto, ['idUsuario'] as const)) {}
