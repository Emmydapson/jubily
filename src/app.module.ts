/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AutomationModule } from './automation/automation.module';
import { PublishingModule } from './publishing/publishing.module';
import { Digistore24Module } from './webhooks/digistore24/digistore24.module';
import { TrackingModule } from './tracking/tracking.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { OffersModule } from './offers/offers.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { BillingModule } from './billing/billing.module';
import { validateEnv } from './config/env.validation';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    ScheduleModule.forRoot(), // ✅ ADD THIS ONCE (global)
    PrismaModule,
    AuditModule,
    AutomationModule,
    PublishingModule,
    Digistore24Module,
    TrackingModule,
    SettingsModule,
    AuthModule,
    MonitoringModule,
    OffersModule,
    WorkspacesModule,
    BillingModule,
  ],
})
export class AppModule {}
