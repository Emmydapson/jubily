/* eslint-disable prettier/prettier */
import { Body, Controller, Post } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { Roles } from '../auth/roles.decorator';
import { RunSlotDto } from './run-slot.dto';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('automation/orchestrator')
@Roles('ADMIN')
@ApiTags('Orchestrator')
@ApiBearerAuth('jwt')
export class OrchestratorController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Post('run')
  @ApiOperation({ summary: 'Run an orchestrator slot', description: 'Requires a valid ADMIN bearer token. Uses scheduledFor when provided.' })
  @ApiBody({ type: RunSlotDto })
  @ApiOkResponse({ description: 'Slot run result.', schema: { example: { ok: true, slot: 'MORNING', jobId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' } } })
  async run(@Body() body: RunSlotDto) {
    const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : new Date();
    return this.orchestrator.runSlot(body.slot, scheduledFor);
  }

  @Post('run-now')
  @ApiOperation({ summary: 'Run an orchestrator slot immediately', description: 'Requires a valid ADMIN bearer token. Ignores scheduledFor and uses the current server time.' })
  @ApiBody({ type: RunSlotDto })
  @ApiOkResponse({ description: 'Immediate slot run result.', schema: { example: { ok: true, slot: 'MORNING', jobId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' } } })
  async runNow(@Body() body: RunSlotDto) {
    return this.orchestrator.runSlot(body.slot, new Date());
  }
}
