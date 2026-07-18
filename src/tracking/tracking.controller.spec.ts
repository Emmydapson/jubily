import {
  Controller,
  Get,
  GoneException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../main';
import { Public } from '../auth/public.decorator';
import { MonitoringService } from '../monitoring/monitoring.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Controller('probe')
class ProbeController {
  @Public()
  @Get()
  ok() {
    return { ok: true };
  }
}

describe('TrackingController public redirect', () => {
  const offerId = 'aabc7ed5-b8b5-4138-8443-f173ac9b3c10';
  let app: INestApplication;
  let tracking: {
    getRedirectOffer: jest.Mock;
    createClick: jest.Mock;
    buildTrustedOfferUrl: jest.Mock;
  };
  let monitoring: { warn: jest.Mock; error: jest.Mock };

  beforeEach(async () => {
    tracking = {
      getRedirectOffer: jest.fn().mockResolvedValue({
        id: offerId,
        hoplink: 'https://merchant.example/product?existing=1',
        network: 'CLICKBANK',
        active: true,
      }),
      createClick: jest.fn().mockResolvedValue({ id: 'click-1' }),
      buildTrustedOfferUrl: jest
        .fn()
        .mockReturnValue(
          'https://merchant.example/product?existing=1&tid=click-1',
        ),
    };
    monitoring = {
      warn: jest.fn().mockResolvedValue(undefined),
      error: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TrackingController, ProbeController],
      providers: [
        { provide: TrackingService, useValue: tracking },
        { provide: MonitoringService, useValue: monitoring },
      ],
    }).compile();

    const nestApp = moduleFixture.createNestApplication();
    configureApp(nestApp);
    await nestApp.init();
    app = nestApp;
  });

  afterEach(async () => {
    await app.close();
  });

  it('reaches GET /r/:offerId publicly without the global /api prefix', async () => {
    await request(app.getHttpServer())
      .get(
        `/r/${offerId}?jobId=1f86c7e1-612b-4c0d-8b18-43d2d887d248&yt=IVNDZNHIktA`,
      )
      .expect(302)
      .expect(
        'Location',
        'https://merchant.example/product?existing=1&tid=click-1',
      );

    expect(tracking.getRedirectOffer).toHaveBeenCalledWith(offerId);
    expect(tracking.createClick).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId,
        videoJobId: '1f86c7e1-612b-4c0d-8b18-43d2d887d248',
        youtubeId: 'IVNDZNHIktA',
        source: 'youtube',
      }),
    );
  });

  it('keeps ordinary application endpoints under /api', async () => {
    await request(app.getHttpServer()).get('/api/probe').expect(200);
    await request(app.getHttpServer()).get('/probe').expect(404);
  });

  it('ignores arbitrary query-string destination URLs', async () => {
    await request(app.getHttpServer())
      .get(
        `/r/${offerId}?destination=https://evil.example&url=https://evil.example`,
      )
      .expect(302)
      .expect(
        'Location',
        'https://merchant.example/product?existing=1&tid=click-1',
      );

    expect(tracking.buildTrustedOfferUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        hoplink: 'https://merchant.example/product?existing=1',
      }),
      'click-1',
    );
  });

  it('returns 404 for unknown offers', async () => {
    tracking.getRedirectOffer.mockRejectedValueOnce(
      new NotFoundException('Offer not found'),
    );

    await request(app.getHttpServer()).get(`/r/${offerId}`).expect(404);
    expect(tracking.createClick).not.toHaveBeenCalled();
  });

  it('returns 410 for inactive offers', async () => {
    tracking.getRedirectOffer.mockRejectedValueOnce(
      new GoneException('Offer is inactive'),
    );

    await request(app.getHttpServer()).get(`/r/${offerId}`).expect(410);
    expect(tracking.createClick).not.toHaveBeenCalled();
  });

  it('redirects even when click analytics recording fails', async () => {
    tracking.createClick.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    tracking.buildTrustedOfferUrl.mockReturnValueOnce(
      'https://merchant.example/product?existing=1',
    );

    await request(app.getHttpServer())
      .get(
        `/r/${offerId}?jobId=1f86c7e1-612b-4c0d-8b18-43d2d887d248&yt=IVNDZNHIktA`,
      )
      .expect(302)
      .expect('Location', 'https://merchant.example/product?existing=1');

    expect(monitoring.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'TRACKING',
        status: 'CLICK_ANALYTICS_FAILED',
        offerId,
      }),
    );
  });
});
