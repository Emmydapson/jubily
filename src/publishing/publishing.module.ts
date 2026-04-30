import { Module } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { MonitoringModule } from 'src/monitoring/monitoring.module';

@Module({
  imports: [MonitoringModule],
  providers: [PublishingService],
  controllers: [PublishingController]
})
export class PublishingModule {}
