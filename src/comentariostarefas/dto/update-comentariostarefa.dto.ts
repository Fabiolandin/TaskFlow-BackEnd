import { PartialType } from '@nestjs/swagger';
import { CreateComentariostarefaDto } from './create-comentariostarefa.dto';

export class UpdateComentariostarefaDto extends PartialType(CreateComentariostarefaDto) {}
