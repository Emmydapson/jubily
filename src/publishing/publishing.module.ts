import { Module } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { MonitoringModule } from 'src/monitoring/monitoring.module';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [MonitoringModule],
  providers: [PublishingService, AdminGuard],
  controllers: [PublishingController],
})
export class PublishingModule {}
