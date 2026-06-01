import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { decryptString } from './settings.crypto';

describe('SettingsService', () => {
  const originalEnv = process.env;
  let prisma: {
    appSettings: {
      findUnique: jest.Mock;
      create: jest.Mock;
      upsert: jest.Mock;
    };
    integrationKey: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: SettingsService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SETTINGS_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    };
    prisma = {
      appSettings: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
      integrationKey: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new SettingsService(prisma as never);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates singleton settings safely when concurrent startup calls race', async () => {
    const created = {
      id: 'app',
      automationEnabled: true,
      verticalEnabled: true,
      autoPublish: true,
      timezone: 'America/New_York',
      videosPerDay: 3,
      runHours: [9, 13, 18],
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };

    prisma.appSettings.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created);
    prisma.appSettings.create
      .mockResolvedValueOnce(created)
      .mockRejectedValueOnce({ code: 'P2002' });

    await expect(Promise.all([service.getSettings(), service.getSettings()])).resolves.toEqual([
      created,
      created,
    ]);

    expect(prisma.appSettings.create).toHaveBeenCalledTimes(2);
    expect(prisma.appSettings.findUnique).toHaveBeenCalledTimes(3);
  });

  it('normalizes scheduling settings before persistence', async () => {
    prisma.appSettings.upsert.mockImplementation(async ({ update }) => ({ id: 'app', ...update }));

    await expect(
      service.updateSettings({
        timezone: '  America/New_York ',
        runHours: [18, 9, 9, 13],
        videosPerDay: 3,
      }),
    ).resolves.toMatchObject({
      timezone: 'America/New_York',
      runHours: [9, 13, 18],
      videosPerDay: 3,
    });

    expect(prisma.appSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'app' },
      create: {
        id: 'app',
        timezone: 'America/New_York',
        runHours: [9, 13, 18],
        videosPerDay: 3,
      },
      update: {
        timezone: 'America/New_York',
        runHours: [9, 13, 18],
        videosPerDay: 3,
      },
    });
  });

  it('rejects invalid timezone, run hours, and videos-per-day values', async () => {
    await expect(service.updateSettings({ timezone: 'Mars/Base' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.updateSettings({ runHours: [9, 24] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.updateSettings({ videosPerDay: 4 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.appSettings.upsert).not.toHaveBeenCalled();
  });

  it('encrypts integration keys, stores last4 only, and returns masked metadata', async () => {
    prisma.integrationKey.upsert.mockImplementation(async ({ update, create, select }) => ({
      provider: create.provider,
      last4: update.last4,
      updatedAt: new Date('2026-05-30T12:00:00.000Z'),
      select,
    }));

    const result = await service.upsertApiKey('OPENAI' as never, 'sk-prod-abcdef');

    const call = prisma.integrationKey.upsert.mock.calls[0][0];
    expect(call.update.encrypted).not.toContain('sk-prod-abcdef');
    expect(decryptString(call.update.encrypted)).toBe('sk-prod-abcdef');
    expect(call.update.last4).toBe('cdef');
    expect(result).toEqual({
      provider: 'OPENAI',
      masked: '••••••••cdef',
      updatedAt: new Date('2026-05-30T12:00:00.000Z'),
    });
  });

  it('masks listed API keys and treats delete as idempotent', async () => {
    prisma.integrationKey.findMany.mockResolvedValue([
      {
        provider: 'OPENAI',
        last4: 'cdef',
        updatedAt: new Date('2026-05-30T12:00:00.000Z'),
        createdAt: new Date('2026-05-01T12:00:00.000Z'),
      },
    ]);
    prisma.integrationKey.delete.mockRejectedValue(new Error('not found'));

    await expect(service.listApiKeys()).resolves.toEqual([
      {
        provider: 'OPENAI',
        masked: '••••••••cdef',
        updatedAt: new Date('2026-05-30T12:00:00.000Z'),
        createdAt: new Date('2026-05-01T12:00:00.000Z'),
      },
    ]);
    await expect(service.deleteApiKey('OPENAI' as never)).resolves.toEqual({ ok: true });
  });
});
