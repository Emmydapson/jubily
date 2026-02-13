/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrchestratorService } from './orchestrator.service';
import { scheduledForSlot } from './time.utils';

@Injectable()
export class AutomationCron {
  private logger = new Logger(AutomationCron.name);

  constructor(private orchestrator: OrchestratorService) {}

  @Cron('0 9 * * *', { timeZone: 'America/New_York' })
  async runMorning() {
    const scheduledFor = scheduledForSlot('MORNING', 'America/New_York');
    this.logger.log(`⏰ Orchestrator run (MORNING) scheduledFor=${scheduledFor.toISOString()}`);
    await this.orchestrator.runSlot('MORNING', scheduledFor);
  }

  @Cron('0 13 * * *', { timeZone: 'America/New_York' })
  async runAfternoon() {
    const scheduledFor = scheduledForSlot('AFTERNOON', 'America/New_York');
    this.logger.log(`⏰ Orchestrator run (AFTERNOON) scheduledFor=${scheduledFor.toISOString()}`);
    await this.orchestrator.runSlot('AFTERNOON', scheduledFor);
  }

  @Cron('0 18 * * *', { timeZone: 'America/New_York' })
  async runEvening() {
    const scheduledFor = scheduledForSlot('EVENING', 'America/New_York');
    this.logger.log(`⏰ Orchestrator run (EVENING) scheduledFor=${scheduledFor.toISOString()}`);
    await this.orchestrator.runSlot('EVENING', scheduledFor);
  }
}
