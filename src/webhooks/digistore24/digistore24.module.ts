/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { Digistore24Controller } from './digistore24.controller';
import { Digistore24Service } from './digistore24.service';
import { ClickbankWebhookController } from './clickbank.controller';
import { MonitoringModule } from 'src/monitoring/monitoring.module';

@Module({
  imports: [MonitoringModule],
  controllers: [Digistore24Controller, ClickbankWebhookController],
  providers: [Digistore24Service],
})
export class Digistore24Module {}
