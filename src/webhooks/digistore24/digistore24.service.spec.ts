import crypto from 'crypto';
import { Digistore24Service } from './digistore24.service';

function signedPayload(payload: Record<string, string>, passphrase: string) {
  const base =
    Object.keys(payload)
      .sort()
      .map((key) => `${key}=${payload[key]}`)
      .join('&') + passphrase;

  return {
    ...payload,
    sha_sign: crypto.createHash('sha512').update(base, 'utf8').digest('hex'),
  };
}

describe('Digistore24Service', () => {
  const originalEnv = process.env;
  let prisma: {
    click: { findUnique: jest.Mock };
    videoJob: { findUnique: jest.Mock };
    conversion: { create: jest.Mock };
    offer: { findFirst: jest.Mock; findUnique: jest.Mock };
  };
  let monitoring: { info: jest.Mock };
  let service: Digistore24Service;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DIGISTORE24_IPN_PASSPHRASE: 'passphrase',
      DIGISTORE24_ALLOW_UNSIGNED: 'false',
    };
    prisma = {
      click: { findUnique: jest.fn() },
      videoJob: { findUnique: jest.fn() },
      conversion: { create: jest.fn() },
      offer: { findFirst: jest.fn(), findUnique: jest.fn() },
    };
    monitoring = { info: jest.fn() };
    service = new Digistore24Service(prisma as never, monitoring as never);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('verifies sha_sign, attributes through click, validates the job FK, and records conversion telemetry', async () => {
    const payload = signedPayload(
      {
        transaction_type: 'payment',
        order_id: 'ORDER-1',
        custom: 'click-1',
        affiliate_amount: '12.50',
        currency: 'USD',
      },
      'passphrase',
    );
    prisma.click.findUnique.mockResolvedValue({ id: 'click-1', workspaceId: 'workspace-1', offerId: 'offer-1', videoJobId: 'job-1' });
    prisma.videoJob.findUnique.mockResolvedValue({ id: 'job-1' });
    prisma.conversion.create.mockResolvedValue({ id: 'conversion-1' });

    await service.processIpn(payload);

    expect(prisma.conversion.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-1',
        offerId: 'offer-1',
        clickId: 'click-1',
        videoJobId: 'job-1',
        event: 'payment',
        amount: 12.5,
        currency: 'USD',
        raw: payload,
      },
    });
    expect(monitoring.info).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'CONVERSION',
        status: 'payment',
        offerId: 'offer-1',
        clickId: 'click-1',
        jobId: 'job-1',
      }),
    );
  });

  it('rejects missing or invalid signatures unless unsigned IPNs are explicitly allowed', async () => {
    await expect(service.processIpn({ event: 'payment' })).rejects.toThrow('Missing sha_sign');

    await expect(
      service.processIpn({ event: 'payment', sha_sign: 'invalid' }),
    ).rejects.toThrow('Invalid sha_sign');

    process.env.DIGISTORE24_IPN_PASSPHRASE = '';
    process.env.DIGISTORE24_ALLOW_UNSIGNED = 'true';
    service = new Digistore24Service(prisma as never, monitoring as never);
    prisma.click.findUnique.mockResolvedValue(null);
    prisma.offer.findFirst.mockResolvedValue({ id: 'offer-from-product' });
    prisma.offer.findUnique.mockResolvedValue({ workspaceId: 'workspace-1' });
    prisma.conversion.create.mockResolvedValue({ id: 'conversion-2' });

    await expect(
      service.processIpn({ event: 'payment', product_id: 'product-1' }),
    ).resolves.toBeUndefined();
    expect(prisma.conversion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: 'workspace-1', offerId: 'offer-from-product' }),
      }),
    );
  });

  it('rejects unattributed conversions instead of writing broken foreign keys', async () => {
    const payload = signedPayload({ event: 'payment', product_id: 'unknown' }, 'passphrase');
    prisma.click.findUnique.mockResolvedValue(null);
    prisma.offer.findFirst.mockResolvedValue(null);

    await expect(service.processIpn(payload)).rejects.toThrow('Unable to attribute conversion');
    expect(prisma.conversion.create).not.toHaveBeenCalled();
  });
});
