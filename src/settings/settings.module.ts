import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, AdminGuard],
  exports: [SettingsService],
})
export class SettingsModule {}
