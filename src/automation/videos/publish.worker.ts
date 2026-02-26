/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleSheetsService } from '../../common/google-sheets.service';
import { YoutubeService } from '../../common/youtube.service';
import { ShotstackServeService } from './shotstack-serve.service'; // adjust path
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

  private isCloudinaryUrl(url: string) {
    return typeof url === 'string' && url.includes('res.cloudinary.com');
  }

  private short(str: string, max = 220) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '...' : str;
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
    'shorts', 'health', 'wellness', 'fitness', 'nutrition',
    'healthytips', 'selfcare', 'workout', 'mindset'
  ];

  const words = [...this.cleanWords(topicTitle), ...this.cleanWords(rawScript)];
  const stop = new Set(['the','and','for','with','your','you','how','to','a','an','of','in','on','is','are']);

  const picked: string[] = [];
  for (const w of words) {
    if (w.length < 4) continue;
    if (stop.has(w)) continue;
    if (!picked.includes(w)) picked.push(w);
    if (picked.length >= 10) break;
  }

  const tags = [...base, ...picked].slice(0, 18);
  // return both hashtag format + tag list format
  return {
    hashtags: tags.map(t => `#${t}`),
    tags: tags.filter(t => t !== 'shorts'), // YouTube tags (no #)
  };
}

private buildDescription(topicTitle: string, contentObj: any, rawScript: string) {
  const hook = String(contentObj?.hook || '').trim();
  const cta = String(contentObj?.cta || '').trim();

  const captionLine1 = hook || topicTitle || 'Quick health tip';
  const captionLine2 = cta || 'Save this and try it today ✅';

  const { hashtags, tags } = this.buildHashtags(topicTitle, rawScript);

  const desc =
`${captionLine1}
${captionLine2}

${hashtags.join(' ')}`.slice(0, 4500);

  return { desc, tags };
}

  private shortHost(url: string) {
    try { return new URL(url).host; } catch { return 'invalid-url'; }
  }

  private async uploadToCloudinaryFromRemoteUrl(remoteUrl: string, publicId: string) {
    const folder = process.env.CLOUDINARY_FOLDER || 'automation';

    // Cloudinary will fetch the remote URL itself (works only if URL is public)
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

  // ✅ if we already have a URL (cdn or stage output), try uploading it
  if (current) {
    this.logger.warn(`☁️ Uploading existing videoUrl job=${job.id} host=${this.shortHost(current)}`);
    const cloudUrl = await this.uploadToCloudinaryFromRemoteUrl(current, job.id);

    await this.prisma.videoJob.update({
      where: { id: job.id },
      data: { videoUrl: cloudUrl },
    });

    return cloudUrl;
  }

  // fallback: resolve via Serve
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

  async loop() {
    if (this.running) return;
    this.running = true;

    while (true) {
      try {
        const jobs = await this.prisma.videoJob.findMany({
          where: {
            status: 'COMPLETED',
            published: false,
            renderId: { not: null }, // ✅ rely on renderId + Serve API
          },
        });

        for (const job of jobs) {
          await this.publish(job);
        }
      } catch (e: any) {
        this.logger.error('Publish worker crash', e?.message || e);
      }

      await new Promise((r) => setTimeout(r, 60000));
    }
  }

  async publish(job: any) {
  // declare outside try so catch can use them
  let topicTitle = '';
  let offerName = '';

  try {
    const fullJob = await this.prisma.videoJob.findUnique({
      where: { id: job.id },
      include: {
        offer: { select: { name: true } },
        script: { include: { topic: { select: { title: true } } } },
      },
    });

    if (!fullJob?.script) throw new Error('Script not found');

    topicTitle = fullJob.script.topic?.title ?? '';
    offerName = fullJob.offer?.name ?? '';

    let contentObj: any = null;
const rawContent = String(fullJob.script.content || '');

try {
  contentObj = JSON.parse(rawContent);
} catch {
  contentObj = null;
}

// Prefer generated title/cta if present, otherwise fallback to topic title
const videoTitle = String(
  contentObj?.title || topicTitle || 'Untitled'
).slice(0, 90);

// Build a nicer description
const { desc: videoDescription, tags } = this.buildDescription(topicTitle, contentObj, rawContent);

        // ensure stable public url (Cloudinary) - via Serve API
    const stableUrl = await this.ensureStableUrl(job);

    this.logger.log(`📤 Publishing job=${job.id} usingHost=${this.shortHost(stableUrl)}`);

    function toSrtTime(seconds: number) {
  const ms = Math.max(0, Math.floor(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const milli = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${milli}`;
}

function buildSrtFromScenes(scenes: any[]) {
  let t = 0;
  const lines: string[] = [];
  let idx = 1;

  for (const sc of scenes) {
    const len = Number(sc.duration || 0);
    const cap = String(sc.caption || sc.narration || '').trim();
    if (!len || !cap) { t += len || 0; continue; }

    const start = t;
    const end = t + len;
    t = end;

    lines.push(
      String(idx++),
      `${toSrtTime(start)} --> ${toSrtTime(end)}`,
      cap.replace(/\n+/g, ' '),
      '',
    );
  }

  return lines.join('\n').trim();
}

const scenes = extractScenes(fullJob.script.content);
const srt = buildSrtFromScenes(scenes);

// store it so frontend can show "videoSrt: true"
await this.prisma.videoJob.update({
  where: { id: job.id },
  data: { videoSrt: srt },
});

    const youtubeId = await this.youtube.upload(videoTitle, videoDescription, stableUrl, tags);
    await this.youtube.uploadCaptions(youtubeId, srt);
    const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

    await this.prisma.videoJob.update({
      where: { id: job.id },
      data: {
        published: true,
        youtubeUrl,
        error: null,
      },
    });

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

    this.logger.log(`✅ YouTube published job=${job.id} youtubeUrl=${youtubeUrl}`);
  } catch (e: any) {
    const msg = e?.message || String(e);

    await this.prisma.videoJob.update({
      where: { id: job.id },
      data: { error: msg },
    });

    await this.sheets.append([
      job.id,
      job.scriptId,
      topicTitle, // now always defined
      offerName,  // now always defined
      'youtube',
      'FAILED',
      '',
      msg,
      job.createdAt,
      new Date(),
    ]);

    this.logger.warn(`❌ Publish failed job=${job.id} msg=${this.short(msg, 300)}`);
  }
}

}
