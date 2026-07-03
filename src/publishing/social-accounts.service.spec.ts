import { ConflictException } from '@nestjs/common';
import { decryptString } from '../settings/settings.crypto';
import { ProviderPublishingError } from './social-publishing.types';
import { SocialAccountsService } from './social-accounts.service';

describe('SocialAccountsService', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  let prisma: any;
  let audit: any;
  let service: SocialAccountsService;

  beforeEach(() => {
    process.env.SETTINGS_MASTER_KEY_BASE64 = key;
    process.env.TIKTOK_CLIENT_KEY = 'tt-key';
    process.env.TIKTOK_REDIRECT_URI = 'https://api.joinjubily.com/api/auth/tiktok/callback';
    process.env.FACEBOOK_APP_ID = 'fb-app';
    process.env.FACEBOOK_REDIRECT_URI = 'https://api.joinjubily.com/api/auth/facebook/callback';
    prisma = {
      socialAccount: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    audit = { record: jest.fn() };
    service = new SocialAccountsService(prisma, audit);
  });

  it('generates TikTok connect URL with state and scopes', () => {
    const url = new URL(service.createTikTokAuthUrl('state-1'));
    expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(url.searchParams.get('client_key')).toBe('tt-key');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.joinjubily.com/api/auth/tiktok/callback');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('scope')).toContain('user.info.basic');
  });

  it('generates Facebook connect URL with state and scopes', () => {
    const url = new URL(service.createFacebookAuthUrl('state-2'));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v20.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('fb-app');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.joinjubily.com/api/auth/facebook/callback');
    expect(url.searchParams.get('state')).toBe('state-2');
    expect(url.searchParams.get('scope')).toContain('pages_show_list');
  });

  it('does not expose encrypted token fields from account listing', async () => {
    prisma.socialAccount.findMany.mockResolvedValue([
      {
        id: 'account-1',
        workspaceId: 'workspace-1',
        provider: 'TIKTOK',
        providerAccountId: 'open-1',
        displayName: 'Creator',
        username: 'creator',
        avatarUrl: null,
        accessTokenEncrypted: 'encrypted',
        accessTokenLast4: 'last',
        refreshTokenEncrypted: 'refresh',
        refreshTokenLast4: 'resh',
        expiresAt: null,
        scopes: ['user.info.basic'],
        metadata: { ok: true },
        connectedAt: new Date(),
        updatedAt: new Date(),
        disconnectedAt: null,
      },
    ]);

    const [account] = await service.listAccounts('workspace-1');
    expect(account).toMatchObject({ id: 'account-1', provider: 'TIKTOK', status: 'CONNECTED' });
    expect(JSON.stringify(account)).not.toContain('encrypted');
    expect(JSON.stringify(account)).not.toContain('refresh');
  });

  it('selects default page/account within the workspace and records audit', async () => {
    prisma.socialAccount.findFirst.mockResolvedValue({
      id: 'account-1',
      workspaceId: 'workspace-1',
      provider: 'FACEBOOK',
      selectedPageId: null,
      selectedInstagramBusinessAccountId: null,
    });
    prisma.socialAccount.update.mockResolvedValue({
      id: 'account-1',
      workspaceId: 'workspace-1',
      provider: 'FACEBOOK',
      providerAccountId: 'me',
      displayName: 'Me',
      scopes: [],
      selectedPageId: 'page-1',
      selectedInstagramBusinessAccountId: 'ig-1',
      connectedAt: new Date(),
      updatedAt: new Date(),
      disconnectedAt: null,
    });

    const result = await service.selectAccount('workspace-1', 'account-1', {
      selectedPageId: 'page-1',
      selectedInstagramBusinessAccountId: 'ig-1',
    }, 'user-1');

    expect(result.selectedPageId).toBe('page-1');
    expect(prisma.socialAccount.findFirst).toHaveBeenCalledWith({ where: { id: 'account-1', workspaceId: 'workspace-1', disconnectedAt: null } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'SOCIAL_ACCOUNT_SELECTED', userId: 'user-1' }));
  });

  it('disconnects account without deleting it', async () => {
    prisma.socialAccount.findFirst.mockResolvedValue({ id: 'account-1', workspaceId: 'workspace-1', provider: 'TIKTOK' });
    prisma.socialAccount.update.mockResolvedValue({
      id: 'account-1',
      workspaceId: 'workspace-1',
      provider: 'TIKTOK',
      providerAccountId: 'open-1',
      displayName: 'Creator',
      scopes: [],
      connectedAt: new Date(),
      updatedAt: new Date(),
      disconnectedAt: new Date(),
    });

    const result = await service.disconnectAccount('workspace-1', 'account-1', 'user-1');
    expect(result.status).toBe('DISCONNECTED');
    expect(prisma.socialAccount.update).toHaveBeenCalledWith({ where: { id: 'account-1' }, data: { disconnectedAt: expect.any(Date) } });
  });

  it('returns friendly provider errors for unapproved TikTok and Meta publishing', async () => {
    await expect(service.publish({ workspaceId: 'workspace-1', provider: 'TIKTOK', videoUrl: 'https://cdn/video.mp4' }))
      .rejects.toEqual(new ProviderPublishingError('TikTok publishing is not enabled yet. App review approval is required.', 'TIKTOK'));
    await expect(service.publish({ workspaceId: 'workspace-1', provider: 'INSTAGRAM', videoUrl: 'https://cdn/video.mp4' }))
      .rejects.toEqual(new ProviderPublishingError('Meta publishing is not enabled yet. App review approval is required.', 'INSTAGRAM'));
    await expect(service.publish({ workspaceId: 'workspace-1', provider: 'YOUTUBE' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('uses encrypted token helper for provider tokens', () => {
    const { encryptString } = jest.requireActual('../settings/settings.crypto');
    const packed = encryptString('provider-token-value');
    expect(packed.encrypted).not.toContain('provider-token-value');
    expect(decryptString(packed.encrypted)).toBe('provider-token-value');
  });
});
