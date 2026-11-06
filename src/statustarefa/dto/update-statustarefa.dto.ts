import { PartialType } from '@nestjs/swagger';
import { CreateStatustarefaDto } from './create-statustarefa.dto';

export class UpdateStatustarefaDto extends PartialType(CreateStatustarefaDto) {}
