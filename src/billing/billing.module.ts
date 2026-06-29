import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuditModule } from '../audit/audit.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PlanGuard } from './plan.guard';
import { PlanLimitsService } from './plan-limits.service';
import { PlatformAdminController } from './platform-admin.controller';
import { GenericBillingWebhookAdapter } from './webhooks/generic-billing-webhook.adapter';
import { BillingPricingService } from './providers/billing-pricing.service';
import { StripeBillingAdapter } from './providers/stripe-billing.adapter';
import { PaystackBillingAdapter } from './providers/paystack-billing.adapter';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [WorkspacesModule, AuditModule],
  controllers: [BillingController, PlatformAdminController],
  providers: [
    BillingService,
    PlanLimitsService,
    PlanGuard,
    GenericBillingWebhookAdapter,
    BillingPricingService,
    StripeBillingAdapter,
    PaystackBillingAdapter,
    AdminGuard,
  ],
  exports: [BillingService, PlanLimitsService, PlanGuard],
})
export class BillingModule {}
