import { Module } from '@nestjs/common';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  controllers: [MonitoringController],
  providers: [MonitoringService, AdminGuard],
  exports: [MonitoringService],
})
export class MonitoringModule {}
