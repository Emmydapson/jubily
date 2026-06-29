/* eslint-disable prettier/prettier */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ActiveWorkspace } from '../../workspaces/workspace.decorator';
import { WorkspaceGuard } from '../../workspaces/workspace.guard';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

@Controller('automation/analytics')
@UseGuards(WorkspaceGuard)
@ApiTags('Analytics')
@ApiBearerAuth('jwt')
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get('weekly')
  @ApiOperation({ summary: 'Get weekly automation analytics', description: 'Requires a valid workspace membership and x-workspace-id.' })
  @ApiQuery({ name: 'days', required: false, example: '7', description: 'Number of days to include.' })
  @ApiQuery({ name: 'tz', required: false, example: 'America/New_York', description: 'IANA timezone for analytics grouping.' })
  @ApiOkResponse({ description: 'Weekly analytics data.', schema: { example: { days: 7, timeZone: 'America/New_York', clicks: 128, conversions: 6, revenue: 174.5 } } })
  weekly(
    @Query('days') days?: string,
    @Query('tz') tz?: string,
    @ActiveWorkspace() workspace?: { id: string } | null,
  ) {
    return this.analytics.weekly({
      days: days ? Number(days) : 7,
      timeZone: tz || 'America/New_York',
      workspaceId: workspace?.id,
    });
  }
}
