/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AutomationModule } from './automation/automation.module';
import { PublishingModule } from './publishing/publishing.module';
import { Digistore24Module } from './webhooks/digistore24/digistore24.module';
import { TrackingModule } from './tracking/tracking.module';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AutomationModule,
    PublishingModule,
    Digistore24Module,
    TrackingModule
  ],
})
export class AppModule {}
