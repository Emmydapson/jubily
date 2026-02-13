/* eslint-disable prettier/prettier */
import { Body, Controller, Post } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';

type Slot = 'MORNING' | 'AFTERNOON' | 'EVENING';

@Controller('automation/orchestrator')
export class OrchestratorController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  // ❗ keep protected if you want (recommended). Remove @Public
  @Post('run')
  async run(@Body() body: { slot: Slot; scheduledFor?: string }) {
    const slot = body.slot;
    const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : new Date();
    return this.orchestrator.runSlot(slot, scheduledFor);
  }

  // Optional: quick health check
  @Post('run-now')
  async runNow(@Body() body: { slot: Slot }) {
    return this.orchestrator.runSlot(body.slot, new Date());
  }
}
