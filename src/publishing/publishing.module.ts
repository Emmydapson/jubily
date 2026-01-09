import { Module } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';

@Module({
  providers: [PublishingService],
  controllers: [PublishingController]
})
export class PublishingModule {}
