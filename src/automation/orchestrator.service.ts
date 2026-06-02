/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationService } from './automation.service';
import { VideosService } from './videos/videos.service';
import { SettingsService } from '../settings/settings.service';
import { VideoJobStatus } from './video-job-status';

type Slot = 'MORNING' | 'AFTERNOON' | 'EVENING';

const FORCE_RERUN_STATUSES = [
  VideoJobStatus.Failed,
  VideoJobStatus.FailedPublish,
  VideoJobStatus.FailedPermanent,
  VideoJobStatus.Cancelled,
];

function hasKeyword(text: string, keyword: string) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(text);
}

export function topicToNicheCandidates(topicTitle: string): string[] {
  const t = String(topicTitle || '').toLowerCase();

  const map: Array<[string, string[]]> = [
    ['sleep', ['sleep', 'insomnia', 'dream']],
    ['weight-loss', ['weight', 'fat', 'burn', 'diet', 'slim']],
    ['energy', ['energy', 'morning', 'fatigue']],
    ['stress', ['stress', 'anxiety', 'calm']],
    ['gut-health', ['gut', 'digestion', 'bloat']],
    ['focus', ['focus', 'brain', 'memory', 'recall', 'concentration']],
    ['fitness', ['fitness', 'workout', 'exercise', 'shape', 'body', 'tone', 'strength']],
    ['hormones', ['hormone', 'hormonal', 'menopause', 'cycle', 'balance']],
    ['memory', ['memory', 'brain', 'focus', 'recall', 'concentration']],
    ['mens-health', ['prostate', 'men', 'male', 'testosterone', 'urinary']],
    ['dental-health', ['teeth', 'dental', 'gum', 'oral', 'mouth', 'breath']],
    ['joint-health', ['joint', 'knee', 'pain', 'mobility', 'cartilage']],
    ['hearing-health', ['hearing', 'ear', 'tinnitus', 'sound']],
  ];

  const hits: string[] = [];
  for (const [niche, keywords] of map) {
    if (keywords.some((k) => hasKeyword(t, k))) hits.push(niche);
  }

  return [...new Set(hits)];
}

@Injectable()
export class OrchestratorService {
  private logger = new Logger(OrchestratorService.name);

  constructor(
    private prisma: PrismaService,
    private automation: AutomationService,
    private videos: VideosService,
    private settingsService: SettingsService,
  ) {}

private async pickOfferForTopic(topicTitle: string) {
  const nicheCandidates = topicToNicheCandidates(topicTitle);

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


  async runSlot(slot: Slot, scheduledFor = new Date(), options: { force?: boolean } = {}) {
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
    select: { id: true, status: true },
  }).catch(() => null);

    if (existing) {
  if (options.force === true && FORCE_RERUN_STATUSES.includes(existing.status as VideoJobStatus)) {
    await this.prisma.videoJob.update({
      where: { id: existing.id },
      data: {
        status: VideoJobStatus.Pending,
        provider: null,
        renderId: null,
        videoUrl: null,
        youtubeVideoId: null,
        youtubeUrl: null,
        publishStage: null,
        videoSrt: null,
        published: false,
        attempts: 0,
        error: null,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });

    const render = await this.videos.startRenderForJob(existing.id);
    return {
      ok: true,
      forced: true,
      reset: true,
      slot,
      scheduledFor: normalized,
      ...render,
    };
  }

  this.logger.warn(
    `⏭️ Already ran slot=${slot} scheduledFor=${normalized.toISOString()} job=${existing.id}`,
  );
  return {
    ok: true,
    skipped: true,
    reason: options.force === true ? 'already-exists-active-or-successful' : 'already-exists',
    slot,
    scheduledFor: normalized, // ✅ normalize in response too
    jobId: existing.id,
  };
}


    // 1) Pick best pending topic
    const topic = await this.prisma.topic.findFirst({
      where: {
        status: 'PENDING',
        OR: [
          { scripts: { none: {} } },
          {
            scripts: {
              some: {
                AND: [
                  { videoJobs: { some: { status: 'FAILED_PERMANENT' } } },
                  { videoJobs: { every: { status: 'FAILED_PERMANENT' } } },
                ],
              },
            },
          },
        ],
      },
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

// Only consume the topic after the downstream render job has been created successfully.
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
