/* eslint-disable prettier/prettier */
import { Controller, Get, Query } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';

@Controller('monitoring/pipeline')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('events')
  events(@Query() query: any) {
    return this.monitoring.list(query);
  }

  @Get('summary')
  summary(@Query() query: any) {
    return this.monitoring.summary(query);
  }
}
