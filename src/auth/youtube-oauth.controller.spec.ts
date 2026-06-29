import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminAuthController } from './admin-auth.controller';
import { AdminGuard } from './admin.guard';
import { IS_PUBLIC_KEY } from './public.decorator';

describe('AuthController YouTube OAuth connect flow', () => {
  let auth: {
    login: jest.Mock;
    me: jest.Mock;
    ensureAdminEmailAllowed: jest.Mock;
  };
  let youtube: {
    getAdminAuthUrl: jest.Mock;
    handleAuthCallback: jest.Mock;
    getChannelDiagnostics: jest.Mock;
  };
  let oauthStates: {
    create: jest.Mock;
    consume: jest.Mock;
  };
  let controller: AdminAuthController;

  const adminReq = {
    user: {
      adminId: 'admin-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      kind: 'admin',
    },
  };

  beforeEach(() => {
    auth = {
      login: jest.fn(),
      me: jest.fn(),
      ensureAdminEmailAllowed: jest.fn((email: string) => email.toLowerCase()),
    };
    youtube = {
      getAdminAuthUrl: jest.fn((state: string) => `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent('https://api.example.com/admin/auth/youtube/callback')}&state=${encodeURIComponent(state)}`),
      handleAuthCallback: jest.fn().mockResolvedValue({ connected: true }),
      getChannelDiagnostics: jest.fn().mockResolvedValue({
        connected: true,
        channelId: 'UC123',
        title: 'Jubily Channel',
        customUrl: '@jubily',
        subscriberCount: '50',
        videoCount: '12',
        statistics: {
          viewCount: '1000',
          subscriberCount: '50',
          hiddenSubscriberCount: false,
          videoCount: '12',
        },
        targetChannelId: 'UC123',
        channelMatchesTarget: true,
        scope: 'https://www.googleapis.com/auth/youtube.upload',
        tokenStorage: {
          encryptedDbConfigured: true,
          encryptedDbUpdatedAt: new Date('2026-06-03T10:00:00.000Z'),
          legacyFilePresent: false,
          legacyFileWriteFallbackEnabled: false,
        },
        error: null,
      }),
    };
    oauthStates = {
      create: jest.fn().mockResolvedValue('state-1'),
      consume: jest.fn().mockResolvedValue({
        purpose: 'admin_youtube',
        adminId: 'admin-1',
        adminEmail: 'admin@example.com',
      }),
    };

    controller = new AdminAuthController(auth as never, youtube as never, oauthStates as never);
  });

  function extractState(url: string) {
    return new URL(url).searchParams.get('state') || '';
  }

  function responseMock() {
    const res = {
      clearCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    return res;
  }

  it('connect requires ADMIN auth and is not public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminAuthController.prototype.youtubeConnect)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminAuthController.prototype.youtubeConnect)).toContain(AdminGuard);
  });

  it('channel diagnostics requires ADMIN auth and returns connected channel metadata', async () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminAuthController.prototype.youtubeChannel)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminAuthController.prototype.youtubeChannel)).toContain(AdminGuard);

    await expect(controller.youtubeChannel()).resolves.toEqual({
      connected: true,
      channelId: 'UC123',
      title: 'Jubily Channel',
      customUrl: '@jubily',
      subscriberCount: '50',
      videoCount: '12',
      statistics: {
        viewCount: '1000',
        subscriberCount: '50',
        hiddenSubscriberCount: false,
        videoCount: '12',
      },
      targetChannelId: 'UC123',
      channelMatchesTarget: true,
      scope: 'https://www.googleapis.com/auth/youtube.upload',
      tokenStorage: {
        encryptedDbConfigured: true,
        encryptedDbUpdatedAt: new Date('2026-06-03T10:00:00.000Z'),
        legacyFilePresent: false,
        legacyFileWriteFallbackEnabled: false,
      },
      error: null,
    });
    expect(youtube.getChannelDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('connect returns a Google OAuth URL with a pending state', async () => {
    const result = await controller.youtubeConnect(adminReq as never);
    const state = extractState(result.url);

    expect(result.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(result.url).toContain(encodeURIComponent('https://api.example.com/admin/auth/youtube/callback'));
    expect(state).toBe('state-1');
    expect(youtube.getAdminAuthUrl).toHaveBeenCalledWith(state);
    expect(oauthStates.create).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'admin_youtube',
      adminId: 'admin-1',
      adminEmail: 'admin@example.com',
    }));
    expect(auth.ensureAdminEmailAllowed).toHaveBeenCalledWith('admin@example.com');
  });

  it('callback validates pending state before storing credentials', async () => {
    const { url } = await controller.youtubeConnect(adminReq as never);
    const state = extractState(url);
    const res = responseMock();

    await controller.youtubeCallback({ headers: {} } as never, res as never, 'code-1', state);

    expect(youtube.handleAuthCallback).toHaveBeenCalledWith('code-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('YouTube connected'));
  });

  it('callback rejects invalid state', async () => {
    const res = responseMock();
    oauthStates.consume.mockResolvedValueOnce(null);

    await expect(
      controller.youtubeCallback({ headers: {} } as never, res as never, 'code-1', 'bad-state'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(oauthStates.consume).toHaveBeenCalledWith('admin_youtube', 'bad-state');
    expect(youtube.handleAuthCallback).not.toHaveBeenCalled();
  });

  it('callback rejects expired state', async () => {
    const { url } = await controller.youtubeConnect(adminReq as never);
    const state = extractState(url);
    oauthStates.consume.mockResolvedValueOnce(null);
    const res = responseMock();

    await expect(
      controller.youtubeCallback({ headers: {} } as never, res as never, 'code-1', state),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(youtube.handleAuthCallback).not.toHaveBeenCalled();
  });
});
