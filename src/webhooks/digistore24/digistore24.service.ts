/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import crypto from 'crypto';
import { MonitoringService } from 'src/monitoring/monitoring.service';

@Injectable()
export class Digistore24Service {
  private readonly logger = new Logger(Digistore24Service.name);
  private readonly allowUnsigned =
    (process.env.DIGISTORE24_ALLOW_UNSIGNED ?? 'false').toLowerCase() === 'true';

  constructor(
    private prisma: PrismaService,
    private monitoring: MonitoringService,
  ) {}

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
      (payload?.product_id ? await this.mapProductToOfferId(String(payload.product_id)) : null);

    if (!offerId) {
      throw new Error(
        `Unable to attribute conversion: missing click match and unmapped product_id=${String(payload?.product_id || '')}`,
      );
    }

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
    const conversion = await this.prisma.conversion.create({
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

    await this.monitoring.info({
      stage: 'CONVERSION',
      status: transactionType,
      message: 'Digistore24 conversion recorded',
      jobId: videoJobId,
      offerId,
      clickId: click?.id || null,
      provider: 'digistore24',
      meta: {
        conversionId: conversion.id,
        orderId,
        amount,
        currency,
      },
    });

    this.logger.log(
      `✅ DS24 IPN saved type=${transactionType} order=${orderId || 'n/a'} click=${click?.id || trackingKey || custom || 'n/a'} videoJob=${videoJobId || 'n/a'}`
    );
  }

  private verifyShaSign(payload: Record<string, any>) {
    const pass = process.env.DIGISTORE24_IPN_PASSPHRASE;
    if (!pass) {
      if (this.allowUnsigned) {
        this.logger.warn(
          'DIGISTORE24_IPN_PASSPHRASE missing; allowing unsigned IPN due to DIGISTORE24_ALLOW_UNSIGNED=true',
        );
        return;
      }

      throw new Error('DIGISTORE24_IPN_PASSPHRASE missing');
    }

    const provided = String(payload?.sha_sign || '').trim();
    if (!provided) throw new Error('Missing sha_sign');

    const keys = Object.keys(payload).filter((k) => k !== 'sha_sign').sort();
    const base = keys.map((k) => `${k}=${String(payload[k])}`).join('&') + pass;
    const computed = crypto.createHash('sha512').update(base, 'utf8').digest('hex');

    if (computed.toLowerCase() !== provided.toLowerCase()) {
      throw new Error('Invalid sha_sign');
    }
  }

  private async mapProductToOfferId(productId: string): Promise<string | null> {
    if (!productId) return null;

    const direct = await this.prisma.offer.findFirst({
      where: {
        network: 'digistore24',
        externalProductId: productId,
      },
      select: { id: true },
    });
    if (direct?.id) return direct.id;

    const rawMap = process.env.DIGISTORE24_PRODUCT_MAP;
    if (!rawMap) return null;

    try {
      const parsed = JSON.parse(rawMap) as Record<string, string>;
      const mappedOfferId = parsed[productId];
      if (!mappedOfferId) return null;

      const offer = await this.prisma.offer.findUnique({
        where: { id: mappedOfferId },
        select: { id: true, network: true },
      });

      if (!offer || String(offer.network).toLowerCase() !== 'digistore24') {
        return null;
      }

      return offer.id;
    } catch {
      this.logger.warn('Invalid DIGISTORE24_PRODUCT_MAP JSON');
      return null;
    }
  }
}
