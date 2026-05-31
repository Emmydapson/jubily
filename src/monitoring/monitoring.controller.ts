/* eslint-disable prettier/prettier */
import { Controller, Get, Query } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { Roles } from 'src/auth/roles.decorator';
import { MonitoringEventsQueryDto, MonitoringSummaryQueryDto } from './dto/monitoring-query.dto';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('monitoring/pipeline')
@Roles('ADMIN')
@ApiTags('Monitoring')
@ApiBearerAuth('jwt')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('health')
  @ApiOperation({ summary: 'Get pipeline monitoring health', description: 'Requires a valid ADMIN bearer token.' })
  @ApiOkResponse({ description: 'Pipeline route health.', schema: { example: { ok: true, route: 'monitoring/pipeline', timestamp: '2026-05-30T14:00:00.000Z' } } })
  health() {
    return { ok: true, route: 'monitoring/pipeline', timestamp: new Date().toISOString() };
  }

  @Get('events')
  @ApiOperation({ summary: 'List pipeline events', description: 'Requires a valid ADMIN bearer token.' })
  @ApiOkResponse({ description: 'Pipeline events.', schema: { example: { items: [{ id: '36ca5c2e-c4bc-4f45-ad02-65f0ed42e2f8', stage: 'RENDER', severity: 'ERROR', status: 'RENDER_FAILED', message: 'Render failed', provider: 'shotstack', createdAt: '2026-05-30T14:00:00.000Z' }] } } })
  events(@Query() query: MonitoringEventsQueryDto) {
    return this.monitoring.list(query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get pipeline event summary', description: 'Requires a valid ADMIN bearer token.' })
  @ApiOkResponse({ description: 'Pipeline summary.', schema: { example: { hours: 24, byStage: { RENDER: 3, PUBLISH: 1 }, bySeverity: { INFO: 10, WARN: 2, ERROR: 1 } } } })
  summary(@Query() query: MonitoringSummaryQueryDto) {
    return this.monitoring.summary(query);
  }
}
