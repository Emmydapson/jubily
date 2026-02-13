/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleSheetsService } from '../../common/google-sheets.service';
import { YoutubeService } from '../../common/youtube.service';
import { ShotstackServeService } from './shotstack-serve.service'; // adjust path
import { v2 as cloudinary } from 'cloudinary';

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

    const videoTitle = String(fullJob.script.content || 'Untitled').slice(0, 90);
    const videoDescription = String(fullJob.script.content || '');

    // ensure stable public url (Cloudinary) - via Serve API
    const stableUrl = await this.ensureStableUrl(job);

    this.logger.log(`📤 Publishing job=${job.id} usingHost=${this.shortHost(stableUrl)}`);

    const youtubeUrl = await this.youtube.upload(videoTitle, videoDescription, stableUrl);

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

    this.logger.log(`✅ YouTube published job=${job.id} youtubeId=${youtubeUrl}`);
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
