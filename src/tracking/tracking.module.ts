import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { DigistoreController } from '../webhooks/digistore24/digistore24.controller';

@Module({
  controllers: [TrackingController, DigistoreController],
  providers: [TrackingService, PrismaService],
  exports: [TrackingService],
})
export class TrackingModule {}
