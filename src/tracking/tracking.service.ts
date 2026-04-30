/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from 'src/monitoring/monitoring.service';

@Injectable()
export class TrackingService {
  constructor(
    private prisma: PrismaService,
    private monitoring: MonitoringService,
  ) {}

  async createClick(data: {
    offerId: string;
    videoJobId?: string;
    youtubeId?: string;
    source?: string;
    ip?: string;
    userAgent?: string;
  }) {
    // ensure offer exists
    const offer = await this.prisma.offer.findFirst({
      where: { id: data.offerId, active: true },
      select: { id: true },
    });
    if (!offer) throw new Error(`Offer not found/disabled: ${data.offerId}`);

    let videoJobId: string | null = null;
    if (data.videoJobId) {
      const job = await this.prisma.videoJob.findUnique({
        where: { id: data.videoJobId },
        select: { id: true, offerId: true },
      });

      if (!job) {
        throw new Error(`Video job not found: ${data.videoJobId}`);
      }

      if (job.offerId && job.offerId !== data.offerId) {
        throw new Error(`Video job ${data.videoJobId} does not belong to offer ${data.offerId}`);
      }

      videoJobId = job.id;
    }

    const created = await this.prisma.click.create({
      data: {
        offerId: data.offerId,
        videoJobId,
        youtubeId: data.youtubeId || null,
        source: data.source || null,
        ip: data.ip || null,
        userAgent: data.userAgent || null,
      },
      select: { id: true },
    });

    await this.monitoring.info({
      stage: 'TRACKING',
      status: 'CLICK_RECORDED',
      message: 'Affiliate click recorded',
      jobId: videoJobId,
      offerId: data.offerId,
      clickId: created.id,
      provider: data.source || 'affiliate',
      meta: {
        youtubeId: data.youtubeId || null,
        hasIp: !!data.ip,
        hasUserAgent: !!data.userAgent,
      },
    });

    return created;
  }

  async buildOfferUrl(offerId: string, clickId: string) {
  const offer = await this.prisma.offer.findUnique({
    where: { id: offerId },
    select: { id: true, hoplink: true, network: true },
  });
  if (!offer) throw new Error('Offer not found');

  const url = new URL(offer.hoplink);

  const net = String(offer.network || '').toLowerCase();

  // ✅ ClickBank uses "tid"
  if (net === 'clickbank') {
    url.searchParams.set('tid', clickId);
  }
  // ✅ Digistore24 uses "custom"
  else if (net === 'digistore24' || net === 'digistore') {
    url.searchParams.set('custom', clickId);
  }
  // ✅ default fallback
  else {
    url.searchParams.set('tid', clickId);
  }

  // Optional override: allow forcing an extra param via env
  // Example: "click_id" or "subid"
  const extraParam = process.env.AFFILIATE_CLICK_PARAM;
  if (extraParam) url.searchParams.set(extraParam, clickId);

  return url.toString();
}
}
