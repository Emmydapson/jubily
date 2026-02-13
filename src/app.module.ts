/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AutomationModule } from './automation/automation.module';
import { PublishingModule } from './publishing/publishing.module';
import { Digistore24Module } from './webhooks/digistore24/digistore24.module';
import { TrackingModule } from './tracking/tracking.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(), // ✅ ADD THIS ONCE (global)
    PrismaModule,
    AutomationModule,
    PublishingModule,
    Digistore24Module,
    TrackingModule,
    SettingsModule,
    AuthModule
  ],
})
export class AppModule {}
