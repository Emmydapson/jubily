import {
  Controller,
  Get,
  HttpException,
  Logger,
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

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function httpExceptionMessage(error: HttpException) {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object' && 'message' in response) {
    const message = (response as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
  }
  return error.message;
}

@Controller()
@ApiTags('Tracking')
export class TrackingController {
  private readonly logger = new Logger(TrackingController.name);

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
  @ApiResponse({ status: 404, description: 'Offer not found.' })
  @ApiResponse({ status: 410, description: 'Offer is inactive.' })
  @ApiResponse({ status: 500, description: 'Tracking redirect failed.' })
  async redirect(
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Query('jobId') jobId: string | undefined,
    @Query('yt') youtubeId: string | undefined,
    @Query('platform') platform: string | undefined,
    @Query('source') source: string | undefined,
    @Query('campaign') campaign: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      this.logger.log({
        message: 'Affiliate redirect received',
        offerId,
        hasJobId: Boolean(jobId),
        hasYoutubeId: Boolean(youtubeId),
        platform: platform || null,
        source: source || null,
        campaign: campaign || null,
      });

      const offer = await this.tracking.getRedirectOffer(offerId);
      let clickId: string | null = null;

      try {
        const click = await this.tracking.createClick({
          offerId,
          videoJobId: jobId,
          youtubeId,
          source: source || platform || 'youtube',
          ip:
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
            req.ip,
          userAgent: req.headers['user-agent'] || '',
        });
        clickId = click.id;
      } catch (analyticsError: unknown) {
        const message = safeErrorMessage(analyticsError);
        this.logger.warn({
          message: 'Affiliate click analytics recording failed',
          offerId,
          jobId: jobId || null,
          youtubeId: youtubeId || null,
          error: message,
        });
        await this.monitoring.warn({
          stage: 'TRACKING',
          status: 'CLICK_ANALYTICS_FAILED',
          message,
          jobId: jobId || null,
          offerId,
          provider: source || platform || 'affiliate',
          meta: { youtubeId: youtubeId || null },
        });
      }

      const hop = this.tracking.buildTrustedOfferUrl(offer, clickId);
      this.logger.log({
        message: 'Affiliate redirect resolved',
        offerId,
        hasClickId: Boolean(clickId),
        destinationHost: new URL(hop).host,
      });
      return res.redirect(hop);
    } catch (e: unknown) {
      if (e instanceof HttpException) {
        const status = e.getStatus();
        this.logger.warn({
          message:
            status === 404
              ? 'Affiliate redirect offer not found'
              : status === 410
                ? 'Affiliate redirect offer inactive'
                : 'Affiliate redirect rejected',
          offerId,
          status,
        });
        const message = httpExceptionMessage(e);
        return res.status(status).send(message);
      }

      const message = safeErrorMessage(e);
      await this.monitoring.error({
        stage: 'TRACKING',
        status: 'REDIRECT_FAILED',
        message,
        jobId: jobId || null,
        offerId,
        provider: 'youtube',
        meta: { youtubeId: youtubeId || null },
      });
      return res.status(500).send('Tracking redirect failed');
    }
  }
}
