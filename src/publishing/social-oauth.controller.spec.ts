import { SocialOAuthController } from './social-oauth.controller';

describe('SocialOAuthController', () => {
  let accounts: any;
  let oauthStates: any;
  let workspaces: any;
  let controller: SocialOAuthController;
  let res: any;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://joinjubily.com';
    accounts = {
      createTikTokAuthUrl: jest.fn(
        (state: string) => `https://tiktok.example/connect?state=${state}`,
      ),
      createFacebookAuthUrl: jest.fn(
        (state: string) => `https://facebook.example/connect?state=${state}`,
      ),
      handleTikTokCallback: jest.fn(),
      handleFacebookCallback: jest.fn(),
    };
    oauthStates = {
      create: jest.fn().mockResolvedValue('state-1'),
      consume: jest
        .fn()
        .mockResolvedValue({ workspaceId: 'workspace-1', userId: 'user-1' }),
    };
    workspaces = {
      requireMembership: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    };
    controller = new SocialOAuthController(accounts, oauthStates, workspaces);
    res = { redirect: jest.fn() };
  });

  it('creates TikTok state and returns connect URL', async () => {
    const result = await controller.tiktokConnect(
      { user: { userId: 'user-1' } } as any,
      { id: 'workspace-1' },
    );
    expect(oauthStates.create).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'workspace_tiktok',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
    );
    expect(result).toEqual({
      url: 'https://tiktok.example/connect?state=state-1',
    });
  });

  it('rejects invalid TikTok callback state before token exchange', async () => {
    oauthStates.consume.mockResolvedValueOnce(null);
    await controller.tiktokCallback(res, 'code-1', 'bad-state');
    expect(oauthStates.consume).toHaveBeenCalledWith(
      'workspace_tiktok',
      'bad-state',
    );
    expect(accounts.handleTikTokCallback).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      'https://joinjubily.com/publishing?error=INVALID_CALLBACK_STATE',
    );
  });

  it('validates TikTok callback state and redirects to publishing', async () => {
    await controller.tiktokCallback(res, 'code-1', 'state-1');
    expect(workspaces.requireMembership).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      ['OWNER', 'ADMIN'],
    );
    expect(accounts.handleTikTokCallback).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      'code-1',
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'https://joinjubily.com/publishing?connected=tiktok',
    );
  });

  it('creates Facebook state and returns connect URL', async () => {
    const result = await controller.facebookConnect(
      { user: { userId: 'user-1' } } as any,
      { id: 'workspace-1' },
    );
    expect(oauthStates.create).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'workspace_facebook',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
    );
    expect(result).toEqual({
      url: 'https://facebook.example/connect?state=state-1',
    });
  });

  it('rejects invalid Facebook callback state before token exchange', async () => {
    oauthStates.consume.mockResolvedValueOnce(null);
    await controller.facebookCallback(res, 'code-1', 'bad-state');
    expect(oauthStates.consume).toHaveBeenCalledWith(
      'workspace_facebook',
      'bad-state',
    );
    expect(accounts.handleFacebookCallback).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      'https://joinjubily.com/publishing?error=INVALID_CALLBACK_STATE',
    );
  });

  it('validates Facebook callback state and redirects to publishing', async () => {
    await controller.facebookCallback(res, 'code-1', 'state-1');
    expect(workspaces.requireMembership).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      ['OWNER', 'ADMIN'],
    );
    expect(accounts.handleFacebookCallback).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      'code-1',
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'https://joinjubily.com/publishing?connected=facebook',
    );
  });
});
