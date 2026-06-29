/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { BillingService } from './billing.service';
import { SuspendWorkspaceDto } from './dto/suspend-workspace.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import type { WorkspaceRequest } from '../workspaces/workspace.types';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Admin - Platform')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin')
export class PlatformAdminController {
  constructor(private readonly billing: BillingService) {}

  @Get('workspaces')
  @ApiOperation({ summary: 'List SaaS workspaces' })
  listWorkspaces() {
    return this.billing.listWorkspaces();
  }

  @Get('users')
  @ApiOperation({ summary: 'List SaaS users' })
  listUsers() {
    return this.billing.listUsers();
  }

  @Get('workspaces/:workspaceId/usage')
  @ApiOperation({ summary: 'View workspace usage' })
  usage(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    return this.billing.getUsageResponse(workspaceId);
  }

  @Get('billing/workspaces/:workspaceId/subscription')
  @ApiOperation({ summary: 'View workspace subscription' })
  subscription(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    return this.billing.getSubscriptionResponse(workspaceId);
  }

  @Patch('billing/workspaces/:workspaceId/subscription')
  @ApiOperation({ summary: 'Manually change workspace plan/status' })
  updateSubscription(
    @Req() req: WorkspaceRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.billing.updateSubscription(workspaceId, {
      ...dto,
      currentPeriodStart: dto.currentPeriodStart ? new Date(dto.currentPeriodStart) : undefined,
      currentPeriodEnd: dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : undefined,
      trialEndsAt: dto.trialEndsAt ? new Date(dto.trialEndsAt) : undefined,
    }, { adminId: req.user?.adminId });
  }

  @Post('workspaces/:workspaceId/suspend')
  @ApiOperation({ summary: 'Suspend a workspace' })
  suspend(
    @Req() req: WorkspaceRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: SuspendWorkspaceDto,
  ) {
    return this.billing.suspendWorkspace(workspaceId, dto?.reason, { adminId: req.user?.adminId });
  }

  @Post('workspaces/:workspaceId/unsuspend')
  @ApiOperation({ summary: 'Unsuspend a workspace' })
  unsuspend(@Req() req: WorkspaceRequest, @Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    return this.billing.unsuspendWorkspace(workspaceId, { adminId: req.user?.adminId });
  }
}
