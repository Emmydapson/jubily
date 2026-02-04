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

    // 2) Pull identifiers
    const event = String(payload?.event || '');
    const orderId = String(payload?.order_id || '');
    const trackingKey = String(payload?.trackingkey || ''); // comes from ds24tr :contentReference[oaicite:6]{index=6}
    const custom = String(payload?.custom || ''); // comes from custom GET param :contentReference[oaicite:7]{index=7}

    const amount = payload?.transaction_amount ? Number(payload.transaction_amount) : null;
    const currency = payload?.transaction_currency ? String(payload.transaction_currency) : null;

    // 3) Resolve click + offer (best effort)
    const click = trackingKey
      ? await this.prisma.click.findUnique({ where: { id: trackingKey } }).catch(() => null)
      : null;

    // If you want: you can also resolve offerId from your click, or from product_id mapping later
    const offerId =
      click?.offerId ||
      (payload?.product_id ? await this.mapProductToOfferId(String(payload.product_id)) : null);

    // 4) Persist Conversion
    await this.prisma.conversion.create({
      data: {
        offerId: offerId || (await this.ensureFallbackOffer()),
        clickId: click?.id || null,
        videoJobId: custom || click?.videoJobId || null,
        event,
        amount: amount ?? undefined,
        currency: currency ?? undefined,
        raw: payload,
      },
    });

    this.logger.log(
      `✅ DS24 IPN saved event=${event} order=${orderId || 'n/a'} click=${trackingKey || 'n/a'} videoJob=${custom || 'n/a'}`
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

    // IMPORTANT:
    // Digistore24 documents that sha_sign is a SHA512 signature and which parameters are included. :contentReference[oaicite:8]{index=8}
    // The exact concatenation rules are in their integration guide; implement per their spec.
    // Below is a common pattern: sort keys, exclude sha_sign, join as key=value, append passphrase, hash sha512.
    const keys = Object.keys(payload).filter((k) => k !== 'sha_sign').sort();

    const base = keys.map((k) => `${k}=${String(payload[k])}`).join('&') + pass;
    const computed = crypto.createHash('sha512').update(base, 'utf8').digest('hex');

    if (computed.toLowerCase() !== provided.toLowerCase()) {
      throw new Error('Invalid sha_sign');
    }
  }

  private async mapProductToOfferId(productId: string): Promise<string | null> {
    // optional: build later when you store Digistore productId in Offer table
    return null;
  }

  private async ensureFallbackOffer(): Promise<string> {
    // optional: fallback offer (so webhook never fails)
    // you can create one record "unknown" once and reuse.
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
