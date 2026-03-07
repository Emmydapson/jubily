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

  private topicToNicheCandidates(topicTitle: string): string[] {
  const t = String(topicTitle || '').toLowerCase();

  // super simple mapping you can expand
  const map: Array<[string, string[]]> = [
    ['sleep', ['sleep', 'insomnia', 'dream']],
    ['weight-loss', ['weight', 'fat', 'burn', 'diet', 'slim']],
    ['fitness', ['fitness', 'workout', 'exercise', 'gym']],
    ['dental', ['dental', 'teeth', 'gum', 'tooth']],
    ['mens-health', ['prostate', 'testosterone', 'men']],
    ['memory', ['brain', 'memory', 'focus']],
    ['gut', ['gut', 'digestion', 'bloat']],
    ['stress', ['stress', 'anxiety', 'calm']],
  ];

  const hits: string[] = [];
  for (const [niche, keywords] of map) {
    if (keywords.some((k) => t.includes(k))) hits.push(niche);
  }

  // always return at least empty list
  return [...new Set(hits)];
}

private async pickOfferForTopic(topicTitle: string) {
  const nicheCandidates = this.topicToNicheCandidates(topicTitle);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Offers used in last 24h
  const recentOfferIds = await this.prisma.videoJob.findMany({
  where: {
    scheduledFor: { gte: since },
    offerId: { not: null },
  },
  select: { offerId: true },
});

  const usedIds = Array.from(
    new Set(recentOfferIds.map((x) => x.offerId).filter(Boolean) as string[]),
  );

  // helper: find offer with optional niche filter, excluding usedIds
  const findOffer = async (useNiche: boolean) => {
  const offers = await this.prisma.offer.findMany({
    where: {
      active: true,
      ...(useNiche && nicheCandidates.length
        ? { nicheTag: { in: nicheCandidates } }
        : {}),
      ...(usedIds.length ? { id: { notIn: usedIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      hoplink: true,
      nicheTag: true,
      network: true,
    },
  });

  if (!offers.length) return null;
  return offers[Math.floor(Math.random() * offers.length)];
};
  // 1) Niche match + not used in last 24h
  let offer = await findOffer(true);
  if (offer) return offer;

  // 2) Any offer + not used in last 24h
  offer = await findOffer(false);
  if (offer) return offer;

  // 3) If everything was used, fallback to niche match even if used
  if (nicheCandidates.length) {
  const offers = await this.prisma.offer.findMany({
    where: { active: true, nicheTag: { in: nicheCandidates } },
    select: { id: true, name: true, hoplink: true, nicheTag: true, network: true },
  });
  if (offers.length) return offers[Math.floor(Math.random() * offers.length)];
}
  // 4) Final fallback: any active offer
  const offers = await this.prisma.offer.findMany({
  where: { active: true },
  select: { id: true, name: true, hoplink: true, nicheTag: true, network: true },
});
if (!offers.length) return null;
return offers[Math.floor(Math.random() * offers.length)];
}
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
   const offer = await this.pickOfferForTopic(topic.title);

if (!offer) {
  this.logger.warn(`No active offer (slot=${slot})`);
  return { ok: true, skipped: true, reason: 'no-offer' };
}
// ✅ generate script WITH offer
const script = await this.automation.generateScriptWithAiOffer(
  topic.id,
  topic.title,
  offer,
);

await this.automation.markTopicUsed(topic.id);

// ✅ create job already stores offerId (you already have offerId in VideoJob)
const job = await this.videos.createVideoJob(script.id, offer.id, slot, normalized);

    
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
