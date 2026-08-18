import { Inject, Injectable } from '@nestjs/common';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class LabelsService {
  @Inject()
  private readonly prisma: PrismaService

  create(createLabelDto: CreateLabelDto) {
    return this.prisma.labels.create({
      data: createLabelDto
    })
  }

  findAll() {
    return this.prisma.labels.findMany({
      select: {id: true, nome: true}
    });
  }

  findOne(id: number) {
    return this.prisma.labels.findUnique({
      where: { id },
    });
  }

  update(id: number, updateLabelDto: UpdateLabelDto) {
    return this.prisma.labels.update({
      where: { id },
      data: updateLabelDto
    })
  }

  remove(id: number) {
    return this.prisma.labels.delete({
      where: { id },
    })
  }
}
