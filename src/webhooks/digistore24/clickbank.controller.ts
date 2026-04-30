/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Body, Controller, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from 'src/auth/public.decorator';
import { Logger } from '@nestjs/common';
import { MonitoringService } from 'src/monitoring/monitoring.service';

@Controller('/webhooks/clickbank')
export class ClickbankWebhookController {
  private readonly logger = new Logger(ClickbankWebhookController.name);

  constructor(
    private prisma: PrismaService,
    private monitoring: MonitoringService,
  ) {}

  @Public()
  @Post()
  async handle(@Body() body: any, @Query('key') key: string | undefined, @Res() res: Response) {
    // ✅ shared secret (simple + effective)
    const secretEnabled = (process.env.CLICKBANK_INS_ENABLED ?? 'true').toLowerCase() === 'true';
    if (secretEnabled) {
      const expected = (process.env.CLICKBANK_INS_SECRET || '').trim();
      if (!expected) {
        this.logger.error('CLICKBANK_INS_SECRET missing while secret check is enabled');
        await this.monitoring.error({
          stage: 'CONVERSION',
          status: 'WEBHOOK_REJECTED',
          message: 'CLICKBANK_INS_SECRET missing while secret check is enabled',
          provider: 'clickbank',
        });
        return res.status(200).send('OK'); // avoid retry storms, but do not process unauthenticated events
      }

      if (key !== expected) {
        await this.monitoring.warn({
          stage: 'CONVERSION',
          status: 'WEBHOOK_REJECTED',
          message: 'ClickBank webhook rejected due to invalid key',
          provider: 'clickbank',
        });
        return res.status(200).send('OK');
      }
    }

    const tid = String(body?.tid || body?.TID || '').trim();
    if (!tid) {
      await this.monitoring.warn({
        stage: 'CONVERSION',
        status: 'WEBHOOK_IGNORED',
        message: 'ClickBank webhook missing tid',
        provider: 'clickbank',
      });
      return res.status(200).send('OK');
    }

    const click = await this.prisma.click.findUnique({
      where: { id: tid },
      select: { id: true, offerId: true, videoJobId: true },
    });
    if (!click) {
      await this.monitoring.error({
        stage: 'CONVERSION',
        status: 'ATTRIBUTION_FAILED',
        message: `ClickBank click not found for tid=${tid}`,
        clickId: tid,
        provider: 'clickbank',
      });
      return res.status(200).send('OK');
    }

    const conversion = await this.prisma.conversion.create({
      data: {
        offerId: click.offerId,
        clickId: click.id,
        videoJobId: click.videoJobId || null,
        event: String(body?.transactionType || body?.type || 'clickbank'),
        amount: body?.amount != null ? Number(body.amount) : null,
        currency: body?.currency ? String(body.currency) : null,
        raw: body,
      },
    });

    await this.monitoring.info({
      stage: 'CONVERSION',
      status: String(body?.transactionType || body?.type || 'clickbank'),
      message: 'ClickBank conversion recorded',
      jobId: click.videoJobId || null,
      offerId: click.offerId,
      clickId: click.id,
      provider: 'clickbank',
      meta: {
        conversionId: conversion.id,
        amount: body?.amount != null ? Number(body.amount) : null,
        currency: body?.currency ? String(body.currency) : null,
      },
    });

    return res.status(200).send('OK');
  }
}
