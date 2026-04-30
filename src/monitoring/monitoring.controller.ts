/* eslint-disable prettier/prettier */
import { Controller, Get, Query } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { Public } from 'src/auth/public.decorator';

@Controller('monitoring/pipeline')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true, route: 'monitoring/pipeline', timestamp: new Date().toISOString() };
  }

  @Get('events')
  events(@Query() query: any) {
    return this.monitoring.list(query);
  }

  @Get('summary')
  summary(@Query() query: any) {
    return this.monitoring.summary(query);
  }
}
