/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TrackingService } from './tracking.service';

@Controller()
export class TrackingController {
  constructor(private tracking: TrackingService) {}

  @Get('r/:offerId')
  async redirect(
    @Param('offerId') offerId: string,
    @Query('jobId') jobId: string | undefined,
    @Query('yt') youtubeId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const click = await this.tracking.createClick({
      offerId,
      videoJobId: jobId,
      youtubeId,
      source: 'youtube',
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
      userAgent: req.headers['user-agent'] || '',
    });

    const hop = await this.tracking.buildOfferUrl(offerId, click.id);
    return res.redirect(hop);
  }
}
