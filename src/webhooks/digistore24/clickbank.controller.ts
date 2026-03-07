/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Body, Controller, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from 'src/auth/public.decorator';

@Controller('/webhooks/clickbank')
export class ClickbankWebhookController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Post()
  async handle(@Body() body: any, @Query('key') key: string | undefined, @Res() res: Response) {
    // ✅ shared secret (simple + effective)
    if (process.env.CLICKBANK_INS_ENABLED === 'true') {
      const expected = process.env.CLICKBANK_INS_SECRET || '';
      if (!expected || key !== expected) return res.status(200).send('OK'); // don't let CB spam retries
    }

    const tid = String(body?.tid || body?.TID || '').trim();
    if (!tid) return res.status(200).send('OK');

    const click = await this.prisma.click.findUnique({
      where: { id: tid },
      select: { id: true, offerId: true, videoJobId: true },
    });
    if (!click) return res.status(200).send('OK');

    await this.prisma.conversion.create({
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

    return res.status(200).send('OK');
  }
}