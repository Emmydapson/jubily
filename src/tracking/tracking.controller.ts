/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { TrackingService } from './tracking.service';
import { Public } from '../auth/public.decorator';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import {
  ApiFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller()
@ApiTags('Tracking')
export class TrackingController {
  constructor(
    private tracking: TrackingService,
    private monitoring: MonitoringService,
  ) {}

  // Public because viewers click this redirect before any Jubily authentication exists.
  @Public()
  @Get('r/:offerId')
  @ApiOperation({
    summary: 'Track a click and redirect to an offer',
    description:
      'Public endpoint used from published video links. No Jubily bearer token is required.',
  })
  @ApiParam({
    name: 'offerId',
    format: 'uuid',
    example: 'd766cd09-66f7-4a22-a8d5-2cf05a2dc7d4',
  })
  @ApiQuery({
    name: 'jobId',
    required: false,
    format: 'uuid',
    example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c',
  })
  @ApiQuery({
    name: 'yt',
    required: false,
    example: 'dQw4w9WgXcQ',
    description: 'YouTube video identifier.',
  })
  @ApiFoundResponse({ description: 'Redirects to the affiliate offer URL.' })
  @ApiResponse({ status: 500, description: 'Tracking redirect failed.' })
  async redirect(
    @Param('offerId', ParseUUIDPipe) offerId: string,
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
        ip:
          (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
          req.ip,
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
