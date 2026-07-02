import { Module } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { PromoCodesService } from './promo-codes.service';
import { PromoCodesController } from './promo-codes.controller';
import { AdminPromoCodesController } from './admin-promo-codes.controller';

@Module({
  controllers: [PromoCodesController, AdminPromoCodesController],
  providers: [PromoCodesService, AdminGuard],
  exports: [PromoCodesService],
})
export class PromosModule {}
