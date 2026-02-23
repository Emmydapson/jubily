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
  private readonly parser = new Parser();

  // Tune with env
  private readonly enabled = (process.env.TOPIC_INGEST_ENABLED || 'true').toLowerCase() === 'true';
  private readonly tab = 'rss';
  private readonly maxPerRun = Number(process.env.TOPIC_INGEST_MAX_PER_RUN || 30);
  private readonly minNewPending = Number(process.env.TOPIC_INGEST_MIN_PENDING || 20);
  private readonly freshHours = Number(process.env.TOPIC_INGEST_FRESH_HOURS || 72);
  private readonly fallbackAiCount = Number(process.env.TOPIC_INGEST_AI_FALLBACK_COUNT || 25);

  // Comma-separated RSS URLs
  private readonly feedUrls: string[] = String(process.env.TOPIC_RSS_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  constructor(
    private prisma: PrismaService,
    private ai: AiService,
  ) {}

  /**
   * Runs every 3 hours by default (change as you like).
   * This only *fills the Topic table*. Your existing orchestrator cron will pick topics.
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

  /**
   * You can also call this manually from a controller if you want a button later.
   */
  async ensurePendingPool() {
    if (!this.enabled) {
      this.logger.warn(`[Ingest] disabled via TOPIC_INGEST_ENABLED=false`);
      return { ok: true, skipped: true, reason: 'disabled' };
    }

    // 1) Check how many pending topics we already have
    const pendingCount = await this.prisma.topic.count({ where: { status: 'PENDING' } });
    this.logger.log(`[Ingest] pendingCount=${pendingCount} minNewPending=${this.minNewPending}`);

    if (pendingCount >= this.minNewPending) {
      return { ok: true, skipped: true, reason: 'enough-pending', pendingCount };
    }

    // 2) Ingest from RSS
    const rssCreated = await this.ingestFromRss();

    // 3) Re-check pending pool, then fallback to AI if still low
    const pendingAfterRss = await this.prisma.topic.count({ where: { status: 'PENDING' } });
    this.logger.log(`[Ingest] pendingAfterRss=${pendingAfterRss} rssCreated=${rssCreated}`);

    let aiCreated = 0;
    if (pendingAfterRss < this.minNewPending) {
      aiCreated = await this.ingestFromAiFallback();
    }

    const pendingFinal = await this.prisma.topic.count({ where: { status: 'PENDING' } });

    this.logger.log(
      `[Ingest] ✅ done rssCreated=${rssCreated} aiCreated=${aiCreated} pendingFinal=${pendingFinal}`,
    );

    return { ok: true, rssCreated, aiCreated, pendingFinal };
  }

  private normalizeTitle(s: string) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .trim();
  }

  private isHealthTopic(s: string) {
    const t = s.toLowerCase();

    // allowlist-ish (health/wellness only)
    const good =
      /health|wellness|sleep|fitness|workout|nutrition|diet|hydration|stress|anxiety|depression|mindfulness|gut|metabolism|protein|fiber|vitamin|hormone|oxytocin|testosterone|blood sugar|cholesterol|heart|liver|kidney|brain|immune|weight|fat loss|walking|steps|meditation|routine/i.test(
        t,
      );

    // blocklist (avoid junk)
    const bad =
      /politic|election|bitcoin|crypto|forex|stock|war|weapon|porn|sex|casino|gambl|celebrity|giveaway|promo code|discount/i.test(
        t,
      );

    return good && !bad;
  }

  private computeScore(title: string, source = 'rss') {
    let score = 50;

    // punchy / “shorts” style
    const len = title.length;
    if (len <= 60) score += 10;
    else if (len <= 85) score += 5;

    // high-performing words
    if (/\b(tips?|habits?|daily|simple|quick|easy|science|mistakes?|avoid|boost|improve)\b/i.test(title)) score += 10;

    // source bias
    if (source === 'rss') score += 5;
    if (source === 'ai') score += 0;

    // clamp
    if (score > 95) score = 95;
    if (score < 10) score = 10;
    return score;
  }

  private pickFresh(items: FeedItem[]) {
    const now = Date.now();
    const cutoff = now - this.freshHours * 60 * 60 * 1000;

    const toTime = (it: FeedItem) => {
      const raw = it.isoDate || it.pubDate;
      const t = raw ? new Date(raw).getTime() : NaN;
      return Number.isFinite(t) ? t : 0;
    };

    return items
      .map((it) => ({ it, t: toTime(it) }))
      .filter((x) => x.t >= cutoff) // fresh window
      .sort((a, b) => b.t - a.t)
      .map((x) => x.it);
  }

  private async topicExists(title: string) {
    const found = await this.prisma.topic.findFirst({
      where: { title },
      select: { id: true },
    });
    return !!found;
  }

  private async createPendingTopic(title: string, source: string, score: number) {
    // your schema already defaults status=PENDING
    return this.prisma.topic.create({
      data: { title, source, score },
    });
  }

  private async ingestFromRss(): Promise<number> {
    if (!this.feedUrls.length) {
      this.logger.warn(`[RSS] No feeds configured. Set TOPIC_RSS_URLS="url1,url2,..."`);
      return 0;
    }

    let created = 0;

    // Fetch feeds sequentially for stability (your droplet is small).
    for (const url of this.feedUrls) {
      if (created >= this.maxPerRun) break;

      try {
        const feed = (await this.parser.parseURL(url)) as unknown as RssFeed;

        const feedTitle = feed?.title || url;
        const items = Array.isArray(feed?.items) ? feed.items : [];
        const fresh = this.pickFresh(items);

        this.logger.log(
          `[RSS] feed="${feedTitle}" items=${items.length} fresh=${fresh.length} urlHost=${this.safeHost(url)}`,
        );

        for (const it of fresh) {
          if (created >= this.maxPerRun) break;

          const rawTitle = this.normalizeTitle(it.title || '');
          if (!rawTitle) continue;

          // Filter to health/wellness only
          if (!this.isHealthTopic(rawTitle)) continue;

          // Convert RSS headline into a good “Shorts topic”
          // (Optional but recommended: makes topics punchy + consistent)
          const topicTitle = await this.rewriteRssTitleToTopic(rawTitle);

          if (!topicTitle || topicTitle.length < 8) continue;
          if (!this.isHealthTopic(topicTitle)) continue;

          const exists = await this.topicExists(topicTitle);
          if (exists) continue;

          const score = this.computeScore(topicTitle, 'rss');
          await this.createPendingTopic(topicTitle, this.tab, score);
          created++;

          this.logger.log(`[RSS] ✅ created score=${score} title="${topicTitle}"`);
        }
      } catch (e: any) {
        this.logger.warn(`[RSS] ❌ feed failed host=${this.safeHost(url)} msg=${e?.message || e}`);
      }
    }

    return created;
  }

  private safeHost(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid-url';
    }
  }

  /**
   * Uses AI to rewrite a generic RSS headline into a “shorts-ready” topic.
   * If AI is mock/unavailable, we just return the RSS title as-is.
   */
  private async rewriteRssTitleToTopic(rssTitle: string): Promise<string> {
    // If you want “no extra cost”, set TOPIC_RSS_REWRITE=false
    const rewriteEnabled = (process.env.TOPIC_RSS_REWRITE || 'true').toLowerCase() === 'true';
    if (!rewriteEnabled) return rssTitle;

    // If AI is in mock mode, AiService will return mock scripts;
    // so here we just do a basic transformation to avoid weirdness.
    const aiMode = (process.env.AI_MODE || 'live').toLowerCase();
    if (aiMode === 'mock') return rssTitle;

    try {
      // Reuse your AiService client; lightweight prompt to rewrite headline into topic
      // We use chat.completions indirectly by calling a tiny helper method:
      // simplest approach: just call generateScript and extract title? Too expensive.
      // So we do a small, cheap completion here by adding a method on AiService later.
      // For now: simple heuristic rewrite (safe + cheap).
      return this.heuristicRewrite(rssTitle);
    } catch {
      return this.heuristicRewrite(rssTitle);
    }
  }

  // Cheap heuristic rewrite (no tokens) — keeps you moving.
  private heuristicRewrite(title: string) {
    const t = this.normalizeTitle(title);

    // Make it sound like a short topic if it’s a newsy headline
    if (/report|study|research|guideline|experts|finds|according to/i.test(t)) {
      return `What this means for your health: ${t}`.slice(0, 120);
    }

    // If it already looks like a topic, keep it
    return t.slice(0, 120);
  }

  /**
   * AI fallback: if RSS didn’t provide enough, generate N health topics and store them.
   * Requires you to add AiService.generateTopics() (I shared earlier).
   */
  private async ingestFromAiFallback(): Promise<number> {
    try {
      const topics = await this.ai.generateTopics(this.fallbackAiCount);

      let created = 0;
      for (const raw of topics) {
        if (created >= this.maxPerRun) break;

        const title = this.normalizeTitle(raw);
        if (!title) continue;
        if (!this.isHealthTopic(title)) continue;

        const exists = await this.topicExists(title);
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