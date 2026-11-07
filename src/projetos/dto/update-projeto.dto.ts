import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProjetoDto } from './create-projeto.dto';

//membros não entram no PATCH: a edição é pelas rotas projetos/:id/membros (SPEC-012)
export class UpdateProjetoDto extends PartialType(OmitType(CreateProjetoDto, ['membros'] as const)) {}
