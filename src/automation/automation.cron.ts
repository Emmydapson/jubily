/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrchestratorService } from './orchestrator.service';
import { SettingsService } from '../settings/settings.service';
import { localHour, scheduledForHour, SLOT_ORDER } from './time.utils';

@Injectable()
export class AutomationCron {
  private logger = new Logger(AutomationCron.name);

  constructor(
    private orchestrator: OrchestratorService,
    private settingsService: SettingsService,
  ) {}

  @Cron('0 * * * *')
  async runConfiguredHours() {
    const settings = await this.settingsService.getSettings();
    if (!settings.automationEnabled) {
      this.logger.warn('Automation cron skipped because automationEnabled=false');
      return;
    }

    const timezone = settings.timezone || 'America/New_York';
    const runHours = Array.from(new Set((settings.runHours || []).map((h) => Number(h))))
      .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
      .slice(0, SLOT_ORDER.length);
    const activeCount = Math.min(
      Math.max(Number(settings.videosPerDay || 1), 1),
      runHours.length,
      SLOT_ORDER.length,
    );
    const hour = localHour(new Date(), timezone);

    for (let i = 0; i < activeCount; i++) {
      if (runHours[i] !== hour) continue;

      const slot = SLOT_ORDER[i];
      const scheduledFor = scheduledForHour(runHours[i], timezone);
      this.logger.log(`[AutomationCron] slot=${slot} hour=${runHours[i]} timezone=${timezone} scheduledFor=${scheduledFor.toISOString()}`);
      await this.orchestrator.runSlot(slot, scheduledFor);
    }
  }
}
