import { PartialType } from '@nestjs/swagger';
import { CreateStatusprojetoDto } from './create-statusprojeto.dto';

export class UpdateStatusprojetoDto extends PartialType(CreateStatusprojetoDto) {}
