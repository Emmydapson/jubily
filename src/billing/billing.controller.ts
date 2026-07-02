/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { ActiveWorkspace } from '../workspaces/workspace.decorator';
import { WorkspaceRoles } from '../workspaces/workspace-roles.decorator';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import type { WorkspaceRequest } from '../workspaces/workspace.types';
import { BillingService } from './billing.service';
import { StartCheckoutDto } from './dto/start-checkout.dto';

@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'List SaaS plans and limits' })
  plans() {
    return this.billing.listPlans();
  }

  @Get('subscription')
  @UseGuards(WorkspaceGuard)
  @ApiOperation({ summary: 'Get active workspace subscription' })
  subscription(@ActiveWorkspace() workspace: { id: string }) {
    return this.billing.getSubscriptionResponse(workspace.id);
  }

  @Get('usage')
  @UseGuards(WorkspaceGuard)
  @ApiOperation({ summary: 'Get active workspace usage for the current period' })
  usage(@ActiveWorkspace() workspace: { id: string }) {
    return this.billing.getUsageResponse(workspace.id);
  }

  @Post('start-checkout')
  @UseGuards(ThrottlerGuard, WorkspaceGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Start checkout placeholder for future billing provider integration' })
  startCheckout(@Req() req: WorkspaceRequest, @ActiveWorkspace() workspace: { id: string }, @Body() dto: StartCheckoutDto) {
    return this.billing.startCheckout(workspace.id, dto?.plan, req.user, {
      provider: dto?.provider,
      interval: dto?.interval,
      country: dto?.country,
      promoCode: dto?.promoCode,
    });
  }

  @Post('cancel')
  @UseGuards(ThrottlerGuard, WorkspaceGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Cancel subscription placeholder' })
  cancel(@Req() req: WorkspaceRequest, @ActiveWorkspace() workspace: { id: string }) {
    return this.billing.cancel(workspace.id, req.user);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('webhook')
  @ApiOperation({ summary: 'Billing provider webhook placeholder' })
  webhook(@Req() req: any, @Query('provider') provider?: string, @Body() body?: unknown) {
    return this.billing.handleWebhook(provider || 'generic', body ?? {}, req.headers ?? {}, req.rawBody);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('webhook/:provider')
  @ApiOperation({ summary: 'Billing provider webhook endpoint' })
  providerWebhook(@Req() req: any, @Param('provider') provider: string, @Body() body?: unknown) {
    return this.billing.handleWebhook(provider, body ?? {}, req.headers ?? {}, req.rawBody);
  }
}
