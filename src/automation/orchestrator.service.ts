/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationService } from './automation.service';
import { VideosService } from './videos/videos.service';
import { SettingsService } from '../settings/settings.service';

type Slot = 'MORNING' | 'AFTERNOON' | 'EVENING';

@Injectable()
export class OrchestratorService {
  private logger = new Logger(OrchestratorService.name);

  constructor(
    private prisma: PrismaService,
    private automation: AutomationService,
    private videos: VideosService,
    private settingsService: SettingsService,
  ) {}

  private normalizeScheduledFor(d: Date) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return this.normalizeScheduledFor(new Date());
  x.setMinutes(0, 0, 0);
  return x;
}


  async runSlot(slot: Slot, scheduledFor = new Date()) {
    // ✅ respect settings
    const settings = await this.settingsService.getSettings();
    if (!settings.automationEnabled) {
      this.logger.warn(`Automation disabled via settings (slot=${slot})`);
      return { ok: true, skipped: true, reason: 'disabled' };
    }

     const normalized = this.normalizeScheduledFor(scheduledFor);

    // ✅ idempotency: if a job exists for this slot+scheduledFor, stop
     const existing = await this.prisma.videoJob.findUnique({
    where: { slot_scheduledFor: { slot, scheduledFor: normalized } },
    select: { id: true },
  }).catch(() => null);

    if (existing) {
  this.logger.warn(
    `⏭️ Already ran slot=${slot} scheduledFor=${normalized.toISOString()} job=${existing.id}`,
  );
  return {
    ok: true,
    skipped: true,
    reason: 'already-exists',
    slot,
    scheduledFor: normalized, // ✅ normalize in response too
    jobId: existing.id,
  };
}


    // 1) Pick best pending topic
    const topic = await this.prisma.topic.findFirst({
      where: { status: 'PENDING' },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    });

    if (!topic) {
      this.logger.warn(`No pending topics (slot=${slot})`);
      return { ok: true, skipped: true, reason: 'no-topics' };
    }

    // 2) Pick an active offer (optional but recommended)
    const offer = await this.prisma.offer.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });

    // 3) Generate script (AI) and mark topic used
    const script = await this.automation.generateScriptWithAi(topic.id, topic.title);
    await this.automation.markTopicUsed(topic.id);

    // 4) Create render job with offer + slot metadata
     const job = await this.videos.createVideoJob(script.id, offer?.id, slot, normalized);
    this.logger.log(
  `✅ slot=${slot} job=${job.jobId} topic="${topic.title}" offer="${offer?.name ?? 'n/a'}" scheduledFor=${normalized.toISOString()}`,
);

return {
  ok: true,
  slot,
  scheduledFor: normalized, // ✅ normalized
  topicId: topic.id,
  topicTitle: topic.title,
  offerId: offer?.id ?? null,
  offerName: offer?.name ?? null,
  scriptId: script.id,
  ...job,
};

  }
}
