/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleSheetsService } from '../../common/google-sheets.service';
import { YoutubeService } from '../../common/youtube.service';
import { ShotstackServeService } from './shotstack-serve.service';
import { v2 as cloudinary } from 'cloudinary';
import { extractScenes } from '../scene.parser';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { randomUUID } from 'crypto';
import { SettingsService } from '../../settings/settings.service';

@Injectable()
export class PublishWorker implements OnModuleInit {
  private running = false;
  private logger = new Logger(PublishWorker.name);
  private autoPublishPausedLogged = false;
  private readonly workerId = `publish-${process.pid}-${randomUUID()}`;
  private readonly lockTtlMs = Number(process.env.WORKER_LOCK_TTL_MS || 30 * 60 * 1000);
  private readonly maxPublishAttempts = Number(process.env.PUBLISH_MAX_ATTEMPTS || 6);
  private readonly enabled =
    (process.env.WORKERS_ENABLED ??
      (process.env.NODE_ENV === 'test' ? 'false' : 'true')).toLowerCase() === 'true';

  constructor(
    private prisma: PrismaService,
    private youtube: YoutubeService,
    private sheets: GoogleSheetsService,
    private serve: ShotstackServeService,
    private monitoring: MonitoringService,
    private settingsService: SettingsService,
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  private lockCutoff() {
    return new Date(Date.now() - this.lockTtlMs);
  }

  private availableLeaseWhere() {
    return [
      { workerLockedAt: null },
      { workerLockedAt: { lt: this.lockCutoff() } },
    ];
  }

  private async claimPublishJob(job: { id: string; renderId: string | null }) {
    const claimed = await this.prisma.videoJob.updateMany({
      where: {
        id: job.id,
        status: 'COMPLETED',
        published: false,
        renderId: job.renderId,
        attempts: { lt: this.maxPublishAttempts },
        script: { reviewStatus: 'APPROVED' },
        OR: this.availableLeaseWhere(),
      },
      data: {
        workerLockedAt: new Date(),
        workerLockedBy: this.workerId,
        workerStage: 'PUBLISH',
        error: null,
      },
    });

    if (claimed.count === 1) {
      this.logger.log(`[PublishClaim] claimed job=${job.id}`);
      return true;
    }

    this.logger.log(`[PublishClaim] skipped job=${job.id}`);
    return false;
  }

  private async releaseClaim(jobId: string, data: Record<string, unknown> = {}) {
    return this.prisma.videoJob.updateMany({
      where: { id: jobId, workerLockedBy: this.workerId },
      data: {
        ...data,
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });
  }

  private async recoverStaleClaims() {
    const recovered = await this.prisma.videoJob.updateMany({
      where: {
        workerStage: 'PUBLISH',
        workerLockedAt: { lt: this.lockCutoff() },
        status: 'COMPLETED',
        published: false,
      },
      data: {
        error: 'Publish claim expired before completion',
        workerLockedAt: null,
        workerLockedBy: null,
        workerStage: null,
      },
    });

    if (recovered.count) {
      this.logger.warn(`[PublishClaim] recovered stale claims count=${recovered.count}`);
    }
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('Publish worker disabled via WORKERS_ENABLED');
      return;
    }

    this.logger.log('Publish worker started');
    void this.loop();
  }

  // -----------------------------
  // Utils
  // -----------------------------
  private isCloudinaryUrl(url: string) {
    return typeof url === 'string' && url.includes('res.cloudinary.com');
  }

  private short(str: string, max = 220) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  private shortHost(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid-url';
    }
  }

  private publicApiBaseUrl() {
    const configured = process.env.PUBLIC_API_BASE_URL || process.env.JUBILY_API_BASE_URL;
    return configured ? String(configured).replace(/\/+$/, '') : null;
  }

  private buildTrackingUrl(apiBaseUrl: string, offerId: string, jobId: string, youtubeId: string) {
    const url = new URL(`/r/${encodeURIComponent(offerId)}`, `${apiBaseUrl}/`);
    url.searchParams.set('jobId', jobId);
    url.searchParams.set('yt', youtubeId);
    return url.toString();
  }

  private buildDescriptionWithOfferLink(baseDesc: string, trackUrl: string) {
    return `${baseDesc}

Recommended product:
${trackUrl}

Affiliate disclosure: We may earn a commission if you buy through this link.`.slice(0, 4500);
  }

  private isPublishRateLimited(err: any): { hit: boolean; reason: string } {
  const reason =
    err?.response?.data?.error?.errors?.[0]?.reason ||
    err?.errors?.[0]?.reason ||
    '';

  // sometimes message contains it too
  const msg = String(err?.message || '');

  const hit =
    reason === 'quotaExceeded' ||
    reason === 'uploadLimitExceeded' ||
    msg.includes('quota') ||
    msg.includes('exceeded the number of videos');

  return { hit, reason: reason || 'unknown' };
}

  private async markPublishPaused(jobId: string, reason: string, msg: string) {
  await this.releaseClaim(jobId, {
      status: 'FAILED_QUOTA', // or rename to 'PUBLISH_PAUSED' if you want
      attempts: { increment: 1 },
      error: `YouTube publish blocked (${reason}): ${msg}`,
  });
  await this.monitoring.warn({
    stage: 'PUBLISH',
    status: 'PAUSED_QUOTA',
    message: `YouTube publish blocked (${reason}): ${msg}`,
    jobId,
    provider: 'youtube',
  });
}

  private cleanWords(s: string) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  private buildHashtags(topicTitle: string, rawScript: string) {
    const base = [
      'shorts',
      'health',
      'wellness',
      'fitness',
      'nutrition',
      'healthytips',
      'selfcare',
      'workout',
      'mindset',
    ];

    const words = [...this.cleanWords(topicTitle), ...this.cleanWords(rawScript)];
    const stop = new Set([
      'the',
      'and',
      'for',
      'with',
      'your',
      'you',
      'how',
      'to',
      'a',
      'an',
      'of',
      'in',
      'on',
      'is',
      'are',
    ]);

    const picked: string[] = [];
    for (const w of words) {
      if (w.length < 4) continue;
      if (stop.has(w)) continue;
      if (!picked.includes(w)) picked.push(w);
      if (picked.length >= 10) break;
    }

    const tags = [...base, ...picked].slice(0, 18);
    return {
      hashtags: tags.map((t) => `#${t}`),
      tags: tags.filter((t) => t !== 'shorts'), // YouTube tags (no #)
    };
  }

  private buildDescription(topicTitle: string, contentObj: any, rawScript: string) {
    const hook = String(contentObj?.hook || '').trim();
    const cta = String(contentObj?.cta || '').trim();

    const captionLine1 = hook || topicTitle || 'Quick health tip';
    const captionLine2 = cta || 'Save this and try it today ✅';

    const { hashtags, tags } = this.buildHashtags(topicTitle, rawScript);

    const desc = `${captionLine1}
${captionLine2}

${hashtags.join(' ')}`.slice(0, 4500);

    return { desc, tags };
  }

  private toSrtTime(seconds: number) {
    const ms = Math.max(0, Math.floor(seconds * 1000));
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    const milli = String(ms % 1000).padStart(3, '0');
    return `${h}:${m}:${s},${milli}`;
  }

  private buildSrtFromScenes(scenes: any[]) {
    let t = 0;
    const lines: string[] = [];
    let idx = 1;

    for (const sc of scenes) {
      const len = Math.max(0, Number(sc.seconds || sc.duration || 0));
      const cap = String(sc.caption || sc.narration || '').trim();
      if (!len || !cap) {
        t += len || 0;
        continue;
      }

      const start = t;
      const end = t + len;
      t = end;

      lines.push(
        String(idx++),
        `${this.toSrtTime(start)} --> ${this.toSrtTime(end)}`,
        cap.replace(/\n+/g, ' '),
        '',
      );
    }

    return lines.join('\n').trim();
  }

  // -----------------------------
  // Cloudinary stability
  // -----------------------------
  private async uploadToCloudinaryFromRemoteUrl(remoteUrl: string, publicId: string) {
    const folder = process.env.CLOUDINARY_FOLDER || 'jubily/videos';

    const res = await cloudinary.uploader.upload(remoteUrl, {
      resource_type: 'video',
      folder,
      public_id: publicId,
      overwrite: true,
    });

    if (!res?.secure_url) throw new Error('Cloudinary upload missing secure_url');
    return res.secure_url;
  }

  private async ensureStableUrl(job: any): Promise<string> {
    const current = String(job.videoUrl || '');
    if (current && this.isCloudinaryUrl(current)) return current;

    // If we already have a URL, upload it to Cloudinary
    if (current) {
      this.logger.warn(`Uploading existing videoUrl job=${job.id} host=${this.shortHost(current)}`);
      const cloudUrl = await this.uploadToCloudinaryFromRemoteUrl(current, job.id);

      await this.prisma.videoJob.update({
        where: { id: job.id },
        data: { videoUrl: cloudUrl },
      });

      return cloudUrl;
    }

    // Fallback: resolve via Serve API
    const renderId = String(job.renderId || '');
    if (!renderId) throw new Error('Missing renderId');

    const { url: serveUrl, status } = await this.serve.getRenderAsset(renderId);

    if (!serveUrl) throw new Error(`Serve asset missing (status=${status})`);
    if (String(status).toLowerCase() !== 'ready') throw new Error(`Serve asset not ready (status=${status})`);

    const cloudUrl = await this.uploadToCloudinaryFromRemoteUrl(serveUrl, job.id);

    await this.prisma.videoJob.update({
      where: { id: job.id },
      data: { videoUrl: cloudUrl },
    });

    return cloudUrl;
  }

  // -----------------------------
  // Main loop
  // -----------------------------
  async loop() {
    if (this.running) return;
    this.running = true;

    while (true) {
      try {
        await this.recoverStaleClaims();

        const settings = await this.settingsService.getSettings();
        if (!settings.autoPublish) {
          if (!this.autoPublishPausedLogged) {
            this.logger.warn('[PublishWorker] autoPublish=false; publish loop paused');
            this.autoPublishPausedLogged = true;
          }
          await new Promise((r) => setTimeout(r, 60_000));
          continue;
        }
        this.autoPublishPausedLogged = false;

        const jobs = await this.prisma.videoJob.findMany({
          where: {
            status: 'COMPLETED',
            published: false,
            renderId: { not: null },
            script: { reviewStatus: 'APPROVED' },
          },
          orderBy: { createdAt: 'asc' },
          take: 25,
        });

        for (const job of jobs) {
          if (await this.claimPublishJob(job)) {
            await this.publish(job);
          }
        }
      } catch (e: any) {
        this.logger.error('Publish worker crash', e?.message || e);
      }

      await new Promise((r) => setTimeout(r, 60_000));
    }
  }

  // -----------------------------
  // Idempotent publish
  // -----------------------------
  async publish(job: any) {
    let topicTitle = '';
    let offerName = '';

    try {
      // Re-fetch full job (fresh data)
      const fullJob = await this.prisma.videoJob.findUnique({
        where: { id: job.id },
        select: {
          id: true,
          offerId: true,
          youtubeUrl: true,
          published: true,
          status: true,
          createdAt: true,
          scriptId: true,
          videoUrl: true,
          renderId: true,
          script: { include: { topic: { select: { title: true } } } },
          offer: { select: { name: true } },
        },
      });

      if (!fullJob?.script) throw new Error('Script not found');

      if (fullJob.script.reviewStatus !== 'APPROVED') {
        await this.releaseClaim(job.id, {
          error:
            fullJob.script.reviewStatus === 'REJECTED'
              ? 'Publish blocked: script reviewStatus is REJECTED'
              : 'Publish blocked: script requires manual approval',
        });
        this.logger.warn(
          `[PublishGate] blocked job=${job.id} script=${fullJob.scriptId} reviewStatus=${fullJob.script.reviewStatus}`,
        );
        await this.monitoring.warn({
          stage: 'PUBLISH',
          status: 'QUALITY_GATE_BLOCKED',
          message:
            fullJob.script.reviewStatus === 'REJECTED'
              ? 'Publish blocked: script reviewStatus is REJECTED'
              : 'Publish blocked: script requires manual approval',
          jobId: job.id,
          scriptId: fullJob.scriptId,
          provider: 'youtube',
          meta: { reviewStatus: fullJob.script.reviewStatus },
        });
        return;
      }

      if (fullJob.published || fullJob.status !== 'COMPLETED') {
        await this.releaseClaim(job.id);
        this.logger.log(`[PublishClaim] skipped stale job=${job.id}`);
        return;
      }

      topicTitle = fullJob.script.topic?.title ?? '';
      offerName = fullJob.offer?.name ?? '';

      // Parse JSON (safe)
      let contentObj: any = null;
      const rawContent = String(fullJob.script.content || '');
      try {
        contentObj = JSON.parse(rawContent);
      } catch {
        contentObj = null;
      }

      const videoTitle = String(contentObj?.title || topicTitle || 'Untitled').slice(0, 90);
      const { desc: baseDesc, tags } = this.buildDescription(topicTitle, contentObj, rawContent);

      // Ensure stable URL (Cloudinary)
      const stableUrl = await this.ensureStableUrl(fullJob);
      this.logger.log(`Publishing job=${job.id} usingHost=${this.shortHost(stableUrl)}`);
      await this.monitoring.info({
        stage: 'PUBLISH',
        status: 'STARTED',
        message: 'Publish flow started',
        jobId: job.id,
        offerId: fullJob.offerId ?? null,
        scriptId: fullJob.scriptId,
        provider: 'youtube',
        meta: { renderId: fullJob.renderId, sourceHost: this.shortHost(stableUrl) },
      });

      // Build + store SRT (non-fatal)
      const scenes = extractScenes(fullJob.script.content);
      const srt = this.buildSrtFromScenes(scenes);

      await this.prisma.videoJob.update({
        where: { id: job.id },
        data: { videoSrt: srt },
      });

      // -----------------------------
      // Idempotency anchor: youtubeId
      // -----------------------------
      let youtubeId: string | null = null;

      if (fullJob.youtubeUrl) {
        try {
          youtubeId = new URL(fullJob.youtubeUrl).searchParams.get('v');
        } catch {
          youtubeId = null;
        }
      }

      // -----------------------------
      // STEP 1: Upload ONCE
      // -----------------------------
      let youtubeUrl = fullJob.youtubeUrl || null;

      if (!youtubeId) {
        try {
  youtubeId = await this.youtube.upload(videoTitle, baseDesc, stableUrl, tags);
} catch (e: any) {
  const gate = this.isPublishRateLimited(e);
  if (gate.hit) {
    await this.markPublishPaused(job.id, gate.reason, e?.message || String(e));
    this.logger.warn(`YouTube publish blocked reason=${gate.reason} job=${job.id}`);
    return; // ✅ stop retry loop
  }
  throw e;
}
        youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

        // ✅ Mark published immediately after upload so retries never re-upload
        const savedUpload = await this.prisma.videoJob.updateMany({
          where: { id: job.id, workerLockedBy: this.workerId },
          data: {
            published: true,
            youtubeVideoId: youtubeId,
            youtubeUrl,
            attempts: 0,
            error: null,
          },
        });

        if (savedUpload.count !== 1) {
          this.logger.warn(`[PublishClaim] upload result skipped because claim was lost job=${job.id}`);
          return;
        }

        // ✅ Write to sheet ONCE on first upload
        await this.sheets.append([
          job.id,
          job.scriptId,
          topicTitle,
          offerName,
          'youtube',
          'PUBLISHED',
          youtubeUrl,
          '',
          job.createdAt,
          new Date(),
        ]);

        this.logger.log(`YouTube uploaded job=${job.id} youtubeId=${youtubeId}`);
        await this.monitoring.info({
          stage: 'PUBLISH',
          status: 'UPLOADED',
          message: 'Video uploaded to YouTube',
          jobId: job.id,
          offerId: fullJob.offerId ?? null,
          scriptId: fullJob.scriptId,
          provider: 'youtube',
          meta: { youtubeId, youtubeUrl },
        });
      } else {
        // already uploaded in the past - ensure published stays true
        await this.prisma.videoJob.updateMany({
          where: { id: job.id, workerLockedBy: this.workerId },
          data: { published: true, youtubeVideoId: youtubeId },
        });
      }

      // -----------------------------
      // STEP 2: Offer link in description (safe retry)
      // -----------------------------
      let finalDesc = baseDesc;

      if (fullJob.offerId && youtubeId) {
        const apiBaseUrl = this.publicApiBaseUrl();
        if (apiBaseUrl) {
          const trackUrl = this.buildTrackingUrl(apiBaseUrl, fullJob.offerId, job.id, youtubeId);
          finalDesc = this.buildDescriptionWithOfferLink(baseDesc, trackUrl);
        } else {
          this.logger.warn(`Tracking link skipped job=${job.id}; set PUBLIC_API_BASE_URL or JUBILY_API_BASE_URL`);
          await this.monitoring.warn({
            stage: 'PUBLISH',
            status: 'TRACKING_LINK_SKIPPED',
            message: 'Tracking link skipped because public API base URL is not configured',
            jobId: job.id,
            offerId: fullJob.offerId,
            scriptId: fullJob.scriptId,
            provider: 'youtube',
          });
        }
      }

      // Update metadata (safe retry; never causes re-upload)
      try {
        await this.youtube.updateMetadata(youtubeId, videoTitle, finalDesc, tags);
        await this.monitoring.info({
          stage: 'PUBLISH',
          status: 'METADATA_DONE',
          message: 'YouTube metadata updated',
          jobId: job.id,
          offerId: fullJob.offerId ?? null,
          scriptId: fullJob.scriptId,
          provider: 'youtube',
          meta: { youtubeId },
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        await this.prisma.videoJob.updateMany({
          where: { id: job.id, workerLockedBy: this.workerId },
          data: { error: `Metadata failed: ${msg}` },
        });
        this.logger.warn(`Metadata failed job=${job.id} msg=${this.short(msg, 250)}`);
        await this.monitoring.warn({
          stage: 'PUBLISH',
          status: 'METADATA_FAILED',
          message: msg,
          jobId: job.id,
          offerId: fullJob.offerId ?? null,
          scriptId: fullJob.scriptId,
          provider: 'youtube',
          meta: { youtubeId },
        });
      }

      // -----------------------------
      // STEP 3: Captions (best-effort; never causes re-upload)
      // -----------------------------
      try {
        await this.youtube.uploadCaptions(youtubeId, srt);
        await this.prisma.videoJob.updateMany({
          where: { id: job.id, workerLockedBy: this.workerId },
          data: { publishStage: 'CAPTIONS_DONE' },
        });
        this.logger.log(`Captions uploaded job=${job.id} youtubeId=${youtubeId}`);
        await this.monitoring.info({
          stage: 'PUBLISH',
          status: 'CAPTIONS_DONE',
          message: 'YouTube captions uploaded',
          jobId: job.id,
          offerId: fullJob.offerId ?? null,
          scriptId: fullJob.scriptId,
          provider: 'youtube',
          meta: { youtubeId },
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        await this.prisma.videoJob.updateMany({
          where: { id: job.id, workerLockedBy: this.workerId },
          data: { publishStage: 'CAPTIONS_FAILED', error: `Captions failed: ${msg}` },
        });
        this.logger.warn(`Captions failed job=${job.id} msg=${this.short(msg, 250)}`);
        await this.monitoring.warn({
          stage: 'PUBLISH',
          status: 'CAPTIONS_FAILED',
          message: msg,
          jobId: job.id,
          offerId: fullJob.offerId ?? null,
          scriptId: fullJob.scriptId,
          provider: 'youtube',
          meta: { youtubeId },
        });
      }

      this.logger.log(`Publish flow done job=${job.id} youtubeId=${youtubeId}`);
      await this.monitoring.info({
        stage: 'PUBLISH',
        status: 'COMPLETED',
        message: 'Publish flow completed',
        jobId: job.id,
        offerId: fullJob.offerId ?? null,
        scriptId: fullJob.scriptId,
        provider: 'youtube',
        meta: { youtubeId, youtubeUrl },
      });
      await this.releaseClaim(job.id, { status: 'COMPLETED', published: true });
    } catch (e: any) {
      const msg = e?.message || String(e);
      const nextAttempts = Number(job.attempts ?? 0) + 1;

      await this.releaseClaim(job.id, {
        attempts: { increment: 1 },
        error: msg,
        ...(nextAttempts >= this.maxPublishAttempts ? { status: 'FAILED_PUBLISH' } : {}),
      });

      // Only mark FAILED in sheet if it never got uploaded.
      // (If it already uploaded, you probably don't want to spam sheet with FAILED)
      try {
        await this.sheets.append([
          job.id,
          job.scriptId,
          topicTitle,
          offerName,
          'youtube',
          
          'FAILED',
          '',
          msg,
          job.createdAt,
          new Date(),
        ]);
      } catch (sheetErr: any) {
        this.logger.warn(`Sheets append failed job=${job.id} msg=${this.short(sheetErr?.message || String(sheetErr), 200)}`);
      }

      this.logger.warn(`Publish failed job=${job.id} msg=${this.short(msg, 300)}`);
      await this.monitoring.error({
        stage: 'PUBLISH',
        status: nextAttempts >= this.maxPublishAttempts ? 'FAILED_PERMANENT' : 'FAILED',
        message: msg,
        jobId: job.id,
        scriptId: job.scriptId ?? null,
        provider: 'youtube',
        meta: { attempts: nextAttempts, maxAttempts: this.maxPublishAttempts },
      });
    }
  }
}
