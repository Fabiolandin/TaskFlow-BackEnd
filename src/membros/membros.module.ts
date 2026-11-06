import { Module } from '@nestjs/common';
import { MembrosService } from './membros.service';
import { MembrosController } from './membros.controller';

@Module({
  controllers: [MembrosController],
  providers: [MembrosService],
})
export class MembrosModule {}
