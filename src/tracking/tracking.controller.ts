/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TrackingService } from './tracking.service';
import { Public } from '../auth/public.decorator';
import { MonitoringService } from 'src/monitoring/monitoring.service';

@Controller()
export class TrackingController {
  constructor(
    private tracking: TrackingService,
    private monitoring: MonitoringService,
  ) {}

  @Public()
  @Get('r/:offerId')
  async redirect(
    @Param('offerId') offerId: string,
    @Query('jobId') jobId: string | undefined,
    @Query('yt') youtubeId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
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
    } catch (e: any) {
      await this.monitoring.error({
        stage: 'TRACKING',
        status: 'REDIRECT_FAILED',
        message: e?.message || String(e),
        jobId: jobId || null,
        offerId,
        provider: 'youtube',
        meta: { youtubeId: youtubeId || null },
      });
      return res.status(500).send('Tracking redirect failed');
    }
  }
}
