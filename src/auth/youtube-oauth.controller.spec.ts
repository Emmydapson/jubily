import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

describe('AuthController YouTube OAuth connect flow', () => {
  let auth: {
    login: jest.Mock;
    me: jest.Mock;
    ensureAdminEmailAllowed: jest.Mock;
  };
  let youtube: {
    getAuthUrl: jest.Mock;
    handleAuthCallback: jest.Mock;
  };
  let controller: AuthController;

  const adminReq = {
    user: {
      adminId: 'admin-1',
      email: 'admin@example.com',
      role: 'ADMIN',
    },
  };

  beforeEach(() => {
    auth = {
      login: jest.fn(),
      me: jest.fn(),
      ensureAdminEmailAllowed: jest.fn((email: string) => email.toLowerCase()),
    };
    youtube = {
      getAuthUrl: jest.fn((state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`),
      handleAuthCallback: jest.fn().mockResolvedValue({ connected: true }),
    };

    controller = new AuthController(auth as never, youtube as never);
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
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.youtubeConnect)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, AuthController)).toEqual(['ADMIN']);
  });

  it('connect returns a Google OAuth URL with a pending state', () => {
    const result = controller.youtubeConnect(adminReq as never);
    const state = extractState(result.url);

    expect(result.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(state).toMatch(/^[a-f0-9]{48}\.[a-f0-9]{64}$/);
    expect(youtube.getAuthUrl).toHaveBeenCalledWith(state);
    expect(auth.ensureAdminEmailAllowed).toHaveBeenCalledWith('admin@example.com');
  });

  it('callback validates pending state before storing credentials', async () => {
    const { url } = controller.youtubeConnect(adminReq as never);
    const state = extractState(url);
    const res = responseMock();

    await controller.youtubeCallback({ headers: {} } as never, res as never, 'code-1', state);

    expect(youtube.handleAuthCallback).toHaveBeenCalledWith('code-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('YouTube connected'));
  });

  it('callback rejects invalid state', async () => {
    const res = responseMock();

    await expect(
      controller.youtubeCallback({ headers: {} } as never, res as never, 'code-1', 'bad-state'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(youtube.handleAuthCallback).not.toHaveBeenCalled();
  });

  it('callback rejects expired state', async () => {
    const { url } = controller.youtubeConnect(adminReq as never);
    const state = extractState(url);
    const pending = (controller as any).pendingYoutubeOAuthStates.get(state);
    pending.expiresAt = Date.now() - 1;
    const res = responseMock();

    await expect(
      controller.youtubeCallback({ headers: {} } as never, res as never, 'code-1', state),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(youtube.handleAuthCallback).not.toHaveBeenCalled();
  });
});
