/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from './ai/ai.service';
import Parser from 'rss-parser';

type FeedItem = {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
};

type RssFeed = {
  title?: string;
  items: FeedItem[];
};

@Injectable()
export class TopicIngestionService {
  private readonly logger = new Logger(TopicIngestionService.name);

  // rss-parser supports custom fetch, but default is fine for now
  private readonly parser = new Parser();

  // Env tuning
  private readonly enabled =
    (process.env.TOPIC_INGEST_ENABLED || 'true').toLowerCase() === 'true';

  // store in Topic.source
  private readonly rssSource = 'rss';

  private readonly maxPerRun = Number(process.env.TOPIC_INGEST_MAX_PER_RUN || 30);
  private readonly minPending = Number(process.env.TOPIC_INGEST_MIN_PENDING || 20);
  private readonly freshHours = Number(process.env.TOPIC_INGEST_FRESH_HOURS || 72);
  private readonly fallbackAiCount = Number(process.env.TOPIC_INGEST_AI_FALLBACK_COUNT || 25);

  // If true, you’ll see per-item date parsing logs (first 3 items per feed)
  private readonly debugDates =
    (process.env.TOPIC_INGEST_DEBUG_DATES || 'false').toLowerCase() === 'true';

  // Comma-separated RSS URLs
  private readonly feedUrls: string[] = String(process.env.TOPIC_RSS_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  constructor(private prisma: PrismaService, private ai: AiService) {}

  /**
   * Runs every 3 hours by default.
   * This ONLY fills Topic table. Orchestrator cron picks from DB later.
   */
  @Cron(process.env.TOPIC_INGEST_CRON || '0 */3 * * *', {
    timeZone: process.env.TOPIC_INGEST_TZ || 'America/New_York',
  })
  async ingestCron() {
    if (!this.enabled) return;

    try {
      await this.ensurePendingPool();
    } catch (e: any) {
      this.logger.error(`[IngestCron] crash msg=${e?.message || e}`);
    }
  }

  async ensurePendingPool() {
    if (!this.enabled) {
      this.logger.warn(`[Ingest] disabled via TOPIC_INGEST_ENABLED=false`);
      return { ok: true, skipped: true, reason: 'disabled' };
    }

    const pendingCount = await this.prisma.topic.count({
      where: { status: 'PENDING' },
    });

    this.logger.log(`[Ingest] pendingCount=${pendingCount} minPending=${this.minPending}`);

    if (pendingCount >= this.minPending) {
      return { ok: true, skipped: true, reason: 'enough-pending', pendingCount };
    }

    const rssCreated = await this.ingestFromRss();

    const pendingAfterRss = await this.prisma.topic.count({
      where: { status: 'PENDING' },
    });

    this.logger.log(
      `[Ingest] pendingAfterRss=${pendingAfterRss} rssCreated=${rssCreated}`,
    );

    let aiCreated = 0;
    if (pendingAfterRss < this.minPending) {
      aiCreated = await this.ingestFromAiFallback();
    }

    const pendingFinal = await this.prisma.topic.count({
      where: { status: 'PENDING' },
    });

    this.logger.log(
      `[Ingest] ✅ done rssCreated=${rssCreated} aiCreated=${aiCreated} pendingFinal=${pendingFinal}`,
    );

    return { ok: true, rssCreated, aiCreated, pendingFinal };
  }

  // -----------------------------
  // Helpers
  // -----------------------------

  private safeHost(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid-url';
    }
  }

  private normalizeTitle(s: string) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .trim();
  }

  // For in-memory dedupe (avoid duplicates inside same run even before DB)
  private normalizeKey(s: string) {
    return this.normalizeTitle(s).toLowerCase();
  }

  private isHealthTopic(s: string) {
    const t = String(s || '').toLowerCase();

    const good =
      /health|wellness|sleep|fitness|workout|nutrition|diet|hydration|stress|anxiety|depression|mindfulness|gut|metabolism|protein|fiber|vitamin|hormone|oxytocin|testosterone|blood sugar|cholesterol|heart|liver|kidney|brain|immune|weight|fat loss|walking|steps|meditation|routine/i.test(
        t,
      );

    const bad =
      /politic|election|bitcoin|crypto|forex|stock|war|weapon|porn|sex|casino|gambl|celebrity|giveaway|promo code|discount/i.test(
        t,
      );

    return good && !bad;
  }

  private computeScore(title: string, source: 'rss' | 'ai') {
    let score = 50;

    const len = title.length;
    if (len <= 60) score += 10;
    else if (len <= 85) score += 5;

    if (/\b(tips?|habits?|daily|simple|quick|easy|science|mistakes?|avoid|boost|improve)\b/i.test(title)) {
      score += 10;
    }

    if (source === 'rss') score += 5;

    if (score > 95) score = 95;
    if (score < 10) score = 10;
    return score;
  }

  private parseItemTime(it: FeedItem): { raw: string; ms: number | null; why?: string } {
    const raw = String(it.isoDate || it.pubDate || '').trim();
    if (!raw) return { raw: '', ms: null, why: 'missing-date' };

    const ms = new Date(raw).getTime();
    if (!Number.isFinite(ms)) return { raw, ms: null, why: 'invalid-date' };

    return { raw, ms };
  }

  private pickFresh(feedTitle: string, items: FeedItem[]) {
    const now = Date.now();
    const cutoff = now - this.freshHours * 60 * 60 * 1000;

    // optional debug: log first 3 items with raw+parsed date
    if (this.debugDates) {
      const sample = items.slice(0, 3);
      for (const it of sample) {
        const dt = this.parseItemTime(it);
        const parsed = dt.ms ? new Date(dt.ms).toISOString() : 'INVALID';
        this.logger.log(
          `[RSS-Date] feed="${feedTitle}" title="${this.normalizeTitle(it.title || '')}" pubRaw="${dt.raw}" parsed="${parsed}" why="${dt.why ?? ''}"`,
        );
      }
    }

    const withTime = items
      .map((it) => {
        const dt = this.parseItemTime(it);
        return { it, ms: dt.ms ?? 0, raw: dt.raw, invalid: dt.ms === null };
      })
      .sort((a, b) => b.ms - a.ms);

    const fresh = withTime.filter((x) => x.ms >= cutoff);

    // if a feed returns 0 fresh, it might be date parsing or just old items
    if (!fresh.length && items.length) {
      const invalidCount = withTime.filter((x) => x.invalid).length;
      this.logger.log(
        `[RSS-Fresh] feed="${feedTitle}" cutoffHours=${this.freshHours} items=${items.length} fresh=0 invalidDates=${invalidCount}`,
      );
    }

    return fresh.map((x) => x.it);
  }

  private async topicExistsInsensitive(title: string) {
    // Postgres supports case-insensitive matching with Prisma "mode: 'insensitive'"
    const found = await this.prisma.topic.findFirst({
      where: { title: { equals: title, mode: 'insensitive' } },
      select: { id: true },
    });
    return !!found;
  }

  private async createPendingTopic(title: string, source: string, score: number) {
    return this.prisma.topic.create({
      data: { title, source, score },
    });
  }

  // -----------------------------
  // RSS ingestion
  // -----------------------------

  private async ingestFromRss(): Promise<number> {
    if (!this.feedUrls.length) {
      this.logger.warn(`[RSS] No feeds configured. Set TOPIC_RSS_URLS="url1,url2,..."`);
      return 0;
    }

    let created = 0;
    const seen = new Set<string>(); // in-run dedupe

    for (const url of this.feedUrls) {
      if (created >= this.maxPerRun) break;

      const host = this.safeHost(url);
      try {
        const feed = (await this.parser.parseURL(url)) as unknown as RssFeed;

        const feedTitle = feed?.title || url;
        const items = Array.isArray(feed?.items) ? feed.items : [];
        const fresh = this.pickFresh(feedTitle, items);

        this.logger.log(
          `[RSS] feed="${feedTitle}" items=${items.length} fresh=${fresh.length} urlHost=${host}`,
        );

        for (const it of fresh) {
          if (created >= this.maxPerRun) break;

          const rawTitle = this.normalizeTitle(it.title || '');
          if (!rawTitle) continue;
          if (!this.isHealthTopic(rawTitle)) continue;

          // Convert RSS headline into a topic title
          const topicTitle = await this.rewriteRssTitleToTopic(rawTitle);
          const cleaned = this.normalizeTitle(topicTitle);

          if (!cleaned || cleaned.length < 8) continue;
          if (!this.isHealthTopic(cleaned)) continue;

          const key = this.normalizeKey(cleaned);
          if (seen.has(key)) continue;
          seen.add(key);

          const exists = await this.topicExistsInsensitive(cleaned);
          if (exists) continue;

          const score = this.computeScore(cleaned, 'rss');
          await this.createPendingTopic(cleaned, this.rssSource, score);
          created++;

          this.logger.log(`[RSS] ✅ created score=${score} title="${cleaned}"`);
        }
      } catch (e: any) {
        const msg = e?.message || String(e);

        // CDC links often 404; make it obvious
        if (/status code 404/i.test(msg)) {
          this.logger.warn(`[RSS] ❌ feed 404 host=${host} url=${url}`);
        } else {
          this.logger.warn(`[RSS] ❌ feed failed host=${host} msg=${msg}`);
        }
      }
    }

    return created;
  }

  /**
   * Cheap/zero-token rewrite (keeps you moving).
   * If later you want AI rewrite, you can add a small method to AiService and swap it in here.
   */
  private async rewriteRssTitleToTopic(rssTitle: string): Promise<string> {
    const rewriteEnabled = (process.env.TOPIC_RSS_REWRITE || 'true').toLowerCase() === 'true';
    if (!rewriteEnabled) return rssTitle;

    return this.heuristicRewrite(rssTitle);
  }

  private heuristicRewrite(title: string) {
    const t = this.normalizeTitle(title);

    if (/report|study|research|guideline|experts|finds|according to/i.test(t)) {
      // keep it short-ish
      const out = `What this means for your health: ${t}`;
      return out.slice(0, 120);
    }

    return t.slice(0, 120);
  }

  // -----------------------------
  // AI fallback (safe compile even if generateTopics isn't implemented)
  // -----------------------------

  private async ingestFromAiFallback(): Promise<number> {
  try {
    const topics = await this.ai.generateTopics(this.fallbackAiCount);

    let created = 0;
    const seen = new Set<string>();

    for (const raw of topics) {
      if (created >= this.maxPerRun) break;

      const title = this.normalizeTitle(raw);
      if (!title) continue;
      if (!this.isHealthTopic(title)) continue;

      const key = this.normalizeKey(title);
      if (seen.has(key)) continue;
      seen.add(key);

      const exists = await this.topicExistsInsensitive(title);
      if (exists) continue;

      const score = this.computeScore(title, 'ai');
      await this.createPendingTopic(title, 'ai', score);
      created++;

      this.logger.log(`[AI-Fallback] ✅ created score=${score} title="${title}"`);
    }

    return created;
  } catch (e: any) {
    this.logger.warn(`[AI-Fallback] ❌ failed msg=${e?.message || e}`);
    return 0;
  }
}
}