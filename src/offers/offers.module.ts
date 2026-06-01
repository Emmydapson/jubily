import { Module } from '@nestjs/common';
import { TrackingModule } from '../tracking/tracking.module';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [TrackingModule],
  controllers: [OffersController],
  providers: [OffersService],
})
export class OffersModule {}

