import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateTarefaDto } from './create-tarefa.dto';

// RF-65: a pai não muda depois da criação; `idTarefaPai` no PATCH é descartado pelo whitelist
export class UpdateTarefaDto extends PartialType(OmitType(CreateTarefaDto, ['idTarefaPai'] as const)) {}
