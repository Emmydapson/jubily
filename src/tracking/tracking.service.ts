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
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new Error('Offer not found');

    const clickParam = process.env.DIGISTORE_CLICK_PARAM || 'clickId';

    // Append clickId safely
    const url = new URL(offer.hoplink);
    url.searchParams.set(clickParam, clickId);
    return url.toString();
  }
}
