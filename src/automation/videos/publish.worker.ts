/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleSheetsService } from '../../common/google-sheets.service';
import { YoutubeService } from '../../common/youtube.service';
import { ShotstackServeService } from './shotstack-serve.service';
import { v2 as cloudinary } from 'cloudinary';
import { extractScenes } from '../scene.parser';

@Injectable()
export class PublishWorker implements OnModuleInit {
  private running = false;
  private logger = new Logger(PublishWorker.name);

  constructor(
    private prisma: PrismaService,
    private youtube: YoutubeService,
    private sheets: GoogleSheetsService,
    private serve: ShotstackServeService,
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  onModuleInit() {
    this.logger.log('📤 Publish worker started');
    this.loop();
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
      const len = Number(sc.duration || 0);
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
    const folder = process.env.CLOUDINARY_FOLDER || 'automation';

    const res = await cloudinary.uploader.upload(remoteUrl, {
      resource_type: 'video',
      folder,
      public_id: publicId,
      overwrite: true,
    });

    if (!res?.secure_url) throw new Error('Cloudinary upload missing secure_url');
    return res.secure_url as string;
  }

  private async ensureStableUrl(job: any): Promise<string> {
    const current = String(job.videoUrl || '');
    if (current && this.isCloudinaryUrl(current)) return current;

    // If we already have a URL, upload it to Cloudinary
    if (current) {
      this.logger.warn(`☁️ Uploading existing videoUrl job=${job.id} host=${this.shortHost(current)}`);
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
        const jobs = await this.prisma.videoJob.findMany({
          where: {
            status: 'COMPLETED',
            published: false,
            renderId: { not: null },
          },
          orderBy: { createdAt: 'asc' },
          take: 25,
        });

        for (const job of jobs) {
          await this.publish(job);
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
          createdAt: true,
          scriptId: true,
          videoUrl: true,
          renderId: true,
          script: { include: { topic: { select: { title: true } } } },
          offer: { select: { name: true } },
        },
      });

      if (!fullJob?.script) throw new Error('Script not found');

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
      this.logger.log(`📤 Publishing job=${job.id} usingHost=${this.shortHost(stableUrl)}`);

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
        youtubeId = await this.youtube.upload(videoTitle, baseDesc, stableUrl, tags);
        youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

        // ✅ Mark published immediately after upload so retries never re-upload
        await this.prisma.videoJob.update({
          where: { id: job.id },
          data: {
            published: true,
            youtubeUrl,
            error: null,
          },
        });

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

        this.logger.log(`✅ YouTube uploaded job=${job.id} youtubeUrl=${youtubeUrl}`);
      } else {
        // already uploaded in the past - ensure published stays true
        await this.prisma.videoJob.update({
          where: { id: job.id },
          data: { published: true },
        });
      }

      // -----------------------------
      // STEP 2: Offer link in description (safe retry)
      // -----------------------------
      let finalDesc = baseDesc;

      if (fullJob.offerId && youtubeId) {
        const trackUrl = `https://api.joinjubily.com/r/${fullJob.offerId}?jobId=${job.id}&yt=${youtubeId}`;
        finalDesc = `${baseDesc}

✅ Recommended product link:
${trackUrl}

(affiliate link)`.slice(0, 4500);
      }

      // Update metadata (safe retry; never causes re-upload)
      try {
        await this.youtube.updateMetadata(youtubeId!, videoTitle, finalDesc, tags);
      } catch (e: any) {
        const msg = e?.message || String(e);
        await this.prisma.videoJob.update({
          where: { id: job.id },
          data: { error: `Metadata failed: ${msg}` },
        });
        this.logger.warn(`⚠️ Metadata failed job=${job.id} msg=${this.short(msg, 250)}`);
      }

      // -----------------------------
      // STEP 3: Captions (best-effort; never causes re-upload)
      // -----------------------------
      try {
        await this.youtube.uploadCaptions(youtubeId!, srt);
      } catch (e: any) {
        const msg = e?.message || String(e);
        await this.prisma.videoJob.update({
          where: { id: job.id },
          data: { error: `Captions failed: ${msg}` },
        });
        this.logger.warn(`⚠️ Captions failed job=${job.id} msg=${this.short(msg, 250)}`);
      }

      this.logger.log(`✅ Publish flow done job=${job.id} youtubeUrl=${youtubeUrl}`);
    } catch (e: any) {
      const msg = e?.message || String(e);

      await this.prisma.videoJob.update({
        where: { id: job.id },
        data: { error: msg },
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
        this.logger.warn(`⚠️ Sheets append failed job=${job.id} msg=${this.short(sheetErr?.message || String(sheetErr), 200)}`);
      }

      this.logger.warn(`❌ Publish failed job=${job.id} msg=${this.short(msg, 300)}`);
    }
  }
}