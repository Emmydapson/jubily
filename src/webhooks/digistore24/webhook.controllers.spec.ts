import { ClickbankWebhookController } from './clickbank.controller';
import { Digistore24Controller } from './digistore24.controller';

function responseMock() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

describe('Webhook controllers', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('handles Digistore24 connection tests without invoking IPN processing', async () => {
    const ds = { processIpn: jest.fn() };
    const monitoring = { error: jest.fn() };
    const controller = new Digistore24Controller(ds as never, monitoring as never);
    const res = responseMock();

    await controller.handle({ body: { event: 'connection_test' } } as never, res as never);

    expect(ds.processIpn).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('OK');
  });

  it('logs Digistore24 processing failures but still returns OK to avoid retry storms', async () => {
    const ds = { processIpn: jest.fn().mockRejectedValue(new Error('bad payload')) };
    const monitoring = { error: jest.fn() };
    const controller = new Digistore24Controller(ds as never, monitoring as never);
    const res = responseMock();

    await controller.handle(
      { body: { event: 'payment', order_id: 'ORDER-1', product_id: 'P1' } } as never,
      res as never,
    );

    expect(monitoring.error).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'CONVERSION',
        status: 'WEBHOOK_FAILED',
        provider: 'digistore24',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('OK');
  });

  it('rejects ClickBank webhooks with an invalid shared secret before attribution', async () => {
    process.env = {
      ...originalEnv,
      CLICKBANK_INS_ENABLED: 'true',
      CLICKBANK_INS_SECRET: 'expected',
    };
    const prisma = {
      click: { findUnique: jest.fn() },
      conversion: { create: jest.fn() },
    };
    const monitoring = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const controller = new ClickbankWebhookController(prisma as never, monitoring as never);
    const res = responseMock();

    await controller.handle({ tid: 'click-1' }, 'wrong', res as never);

    expect(monitoring.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'CONVERSION',
        status: 'WEBHOOK_REJECTED',
        provider: 'clickbank',
      }),
    );
    expect(prisma.click.findUnique).not.toHaveBeenCalled();
    expect(prisma.conversion.create).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('OK');
  });

  it('records ClickBank conversions for valid attributed clicks', async () => {
    process.env = {
      ...originalEnv,
      CLICKBANK_INS_ENABLED: 'true',
      CLICKBANK_INS_SECRET: 'expected',
    };
    const prisma = {
      click: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'click-1',
          workspaceId: 'workspace-1',
          offerId: 'offer-1',
          videoJobId: 'job-1',
        }),
      },
      conversion: { create: jest.fn().mockResolvedValue({ id: 'conversion-1' }) },
    };
    const monitoring = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const controller = new ClickbankWebhookController(prisma as never, monitoring as never);
    const res = responseMock();

    await controller.handle(
      { tid: 'click-1', transactionType: 'SALE', amount: '49.00', currency: 'USD' },
      'expected',
      res as never,
    );

    expect(prisma.conversion.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-1',
        offerId: 'offer-1',
        clickId: 'click-1',
        videoJobId: 'job-1',
        event: 'SALE',
        amount: 49,
        currency: 'USD',
        raw: { tid: 'click-1', transactionType: 'SALE', amount: '49.00', currency: 'USD' },
      },
    });
    expect(monitoring.info).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'CONVERSION',
        status: 'SALE',
        clickId: 'click-1',
      }),
    );
    expect(res.send).toHaveBeenCalledWith('OK');
  });

  it('rejects ClickBank webhooks when secret checking is enabled but no secret is configured', async () => {
    process.env = {
      ...originalEnv,
      CLICKBANK_INS_ENABLED: 'true',
      CLICKBANK_INS_SECRET: '',
    };
    const prisma = {
      click: { findUnique: jest.fn() },
      conversion: { create: jest.fn() },
    };
    const monitoring = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const controller = new ClickbankWebhookController(prisma as never, monitoring as never);
    const res = responseMock();

    await controller.handle({ tid: 'click-1' }, undefined, res as never);

    expect(monitoring.error).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'CONVERSION',
        status: 'WEBHOOK_REJECTED',
        provider: 'clickbank',
      }),
    );
    expect(prisma.conversion.create).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('OK');
  });

  it('ignores ClickBank payloads without tid and logs attribution failures for unknown clicks', async () => {
    process.env = {
      ...originalEnv,
      CLICKBANK_INS_ENABLED: 'false',
    };
    const prisma = {
      click: { findUnique: jest.fn().mockResolvedValue(null) },
      conversion: { create: jest.fn() },
    };
    const monitoring = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const controller = new ClickbankWebhookController(prisma as never, monitoring as never);
    const missingTidRes = responseMock();
    const unknownClickRes = responseMock();

    await controller.handle({ transactionType: 'SALE' }, undefined, missingTidRes as never);
    expect(monitoring.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'CONVERSION',
        status: 'WEBHOOK_IGNORED',
      }),
    );

    await controller.handle({ tid: 'missing-click' }, undefined, unknownClickRes as never);
    expect(monitoring.error).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'CONVERSION',
        status: 'ATTRIBUTION_FAILED',
        clickId: 'missing-click',
      }),
    );
    expect(prisma.conversion.create).not.toHaveBeenCalled();
  });
});
