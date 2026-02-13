/* eslint-disable prettier/prettier */
import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('automation/analytics')
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get('weekly')
  weekly(
    @Query('days') days?: string,
    @Query('tz') tz?: string,
  ) {
    return this.analytics.weekly({
      days: days ? Number(days) : 7,
      timeZone: tz || 'America/New_York',
    });
  }
}
