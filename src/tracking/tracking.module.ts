/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { MonitoringModule } from 'src/monitoring/monitoring.module';


@Module({
  imports: [MonitoringModule],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
