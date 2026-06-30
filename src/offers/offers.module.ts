import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TrackingModule } from '../tracking/tracking.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [AuditModule, TrackingModule, WorkspacesModule],
  controllers: [OffersController],
  providers: [OffersService],
})
export class OffersModule {}
