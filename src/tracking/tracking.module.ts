/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { Digistore24Controller } from '../webhooks/digistore24/digistore24.controller';
import { Digistore24Service } from 'src/webhooks/digistore24/digistore24.service';


@Module({
  controllers: [TrackingController, Digistore24Controller],
  providers: [TrackingService, PrismaService],
  exports: [TrackingService, Digistore24Service],
})
export class TrackingModule {}
