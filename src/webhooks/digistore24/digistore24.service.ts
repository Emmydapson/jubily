/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import crypto from 'crypto';

@Injectable()
export class Digistore24Service {
  private readonly logger = new Logger(Digistore24Service.name);

  constructor(private prisma: PrismaService) {}

  async processIpn(payload: Record<string, any>) {
    // 1) Verify signature (recommended)
    this.verifyShaSign(payload);

    // 2) Normalize fields (Digistore uses transaction_type a lot)
    const transactionType = String(payload?.transaction_type || payload?.event || 'unknown');
    const orderId = String(payload?.order_id || payload?.transaction_id || '');

    // Digistore params we care about
    const trackingKey = String(payload?.trackingkey || ''); // usually ds24tr
    const custom = String(payload?.custom || ''); // usually custom

    // Amount fields vary depending on config; keep best-effort
    const amount =
      payload?.affiliate_amount != null ? Number(payload.affiliate_amount)
      : payload?.transaction_amount != null ? Number(payload.transaction_amount)
      : null;

    const currency =
      payload?.currency ? String(payload.currency)
      : payload?.transaction_currency ? String(payload.transaction_currency)
      : null;

    // 3) Resolve click (best effort)
    const click =
  custom
    ? await this.prisma.click.findUnique({ where: { id: custom } }).catch(() => null)
    : trackingKey
    ? await this.prisma.click.findUnique({ where: { id: trackingKey } }).catch(() => null)
    : null;


    // 4) Resolve offer
    const offerId =
      click?.offerId ||
      (payload?.product_id ? await this.mapProductToOfferId(String(payload.product_id)) : null) ||
      (await this.ensureFallbackOffer());

    // 5) Resolve videoJobId safely (ONLY if it exists)
    let videoJobId: string | null = null;

    // Prefer click.videoJobId (because it's ours)
    const candidate = click?.videoJobId || null;

    if (candidate) {
      const exists = await this.prisma.videoJob.findUnique({ where: { id: candidate } }).catch(() => null);
      if (exists) videoJobId = candidate;
    }

    // Optional: if you *intend* custom to sometimes be a videoJobId, allow it safely:
    if (!videoJobId && custom) {
      const exists = await this.prisma.videoJob.findUnique({ where: { id: custom } }).catch(() => null);
      if (exists) videoJobId = custom;
    }

    // 6) Persist Conversion (never violate FK)
    await this.prisma.conversion.create({
      data: {
        offerId,
        clickId: click?.id || null,
        videoJobId,
        event: transactionType,
        amount: amount ?? undefined,
        currency: currency ?? undefined,
        raw: payload,
      },
    });

    this.logger.log(
      `✅ DS24 IPN saved type=${transactionType} order=${orderId || 'n/a'} click=${click?.id || trackingKey || custom || 'n/a'} videoJob=${videoJobId || 'n/a'}`
    );
  }

  private verifyShaSign(payload: Record<string, any>) {
    const pass = process.env.DIGISTORE24_IPN_PASSPHRASE;
    if (!pass) {
      this.logger.warn('DIGISTORE24_IPN_PASSPHRASE missing; skipping sha_sign verification');
      return;
    }

    const provided = String(payload?.sha_sign || '');
    if (!provided) throw new Error('Missing sha_sign');

    const keys = Object.keys(payload).filter((k) => k !== 'sha_sign').sort();
    const base = keys.map((k) => `${k}=${String(payload[k])}`).join('&') + pass;
    const computed = crypto.createHash('sha512').update(base, 'utf8').digest('hex');

    if (computed.toLowerCase() !== provided.toLowerCase()) {
      throw new Error('Invalid sha_sign');
    }
  }

  private async mapProductToOfferId(productId: string): Promise<string | null> {
    return null;
  }

  private async ensureFallbackOffer(): Promise<string> {
    const existing = await this.prisma.offer.findFirst({ where: { name: 'unknown' } });
    if (existing) return existing.id;

    const created = await this.prisma.offer.create({
      data: {
        name: 'unknown',
        hoplink: 'unknown',
        network: 'digistore24',
        active: false,
      },
    });
    return created.id;
  }
}
