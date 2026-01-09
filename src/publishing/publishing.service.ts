import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePublishResultDto } from './dto/create-publish-result.dto';

@Injectable()
export class PublishingService {
  constructor(private prisma: PrismaService) {}

  async registerResult(dto: CreatePublishResultDto) {
    return this.prisma.publishResult.create({
      data: {
        ...dto,
        publishedAt: dto.status === 'SUCCESS' ? new Date() : null,
      },
    });
  }
}
