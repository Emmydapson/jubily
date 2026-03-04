/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrackingService {
  constructor(private prisma: PrismaService) {}

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

    return this.prisma.click.create({
      data: {
        offerId: data.offerId,
        videoJobId: data.videoJobId || null,
        youtubeId: data.youtubeId || null,
        source: data.source || null,
        ip: data.ip || null,
        userAgent: data.userAgent || null,
      },
      select: { id: true },
    });
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
