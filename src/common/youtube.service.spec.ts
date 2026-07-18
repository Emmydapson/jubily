import { google } from 'googleapis';
import axios from 'axios';
import { YoutubeService } from './youtube.service';
import { encryptString } from '../settings/settings.crypto';

jest.mock('axios');

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('googleapis', () => {
  const channelsList = jest.fn();

  return {
    google: {
      auth: {
        OAuth2: jest.fn(
          (_clientId: string, _clientSecret: string, redirectUri: string) => ({
            on: jest.fn(),
            setCredentials: jest.fn(),
            generateAuthUrl: jest.fn((params: Record<string, string>) => {
              const url = new URL(
                'https://accounts.google.com/o/oauth2/v2/auth',
              );
              url.searchParams.set('redirect_uri', redirectUri);
              if (params.state) url.searchParams.set('state', params.state);
              return url.toString();
            }),
            getToken: jest.fn().mockResolvedValue({
              tokens: {
                access_token: 'workspace-access-token',
                refresh_token: 'workspace-refresh-token',
                scope: 'workspace-scope',
                expiry_date: 123,
              },
            }),
          }),
        ),
      },
      youtube: jest.fn(() => ({
        channels: { list: channelsList },
      })),
    },
  };
});

describe('YoutubeService diagnostics', () => {
  const oldEnv = process.env;
  let prisma: {
    integrationKey: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    workspaceYoutubeConnection: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  const mockedGoogle = google as unknown as {
    youtube: jest.Mock;
  };
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...oldEnv };
    process.env.YOUTUBE_CLIENT_ID = 'client';
    process.env.YOUTUBE_CLIENT_SECRET = 'secret';
    process.env.YOUTUBE_REDIRECT_URI =
      'https://api.joinjubily.com/api/auth/youtube/callback';
    process.env.YOUTUBE_ADMIN_REDIRECT_URI =
      'https://api.example.com/admin/auth/youtube/callback';
    process.env.YOUTUBE_CUSTOMER_REDIRECT_URI =
      'https://api.example.com/workspaces/youtube/callback';
    prisma = {
      integrationKey: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      workspaceYoutubeConnection: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  function serviceWithTokens(tokens: Record<string, unknown>) {
    const service = new YoutubeService(prisma as never);
    jest.spyOn(service as any, 'loadGlobalTokens').mockResolvedValue(tokens);
    return service;
  }

  it('generates admin and customer YouTube auth URLs with the correct redirect URIs', async () => {
    const service = new YoutubeService(prisma as never);

    const adminUrl = service.getAdminAuthUrl('admin-state');
    const customerUrl = service.getCustomerAuthUrl('customer-state');
    await service
      .handleWorkspaceAuthCallback('workspace-1', 'oauth-code')
      .catch(() => undefined);

    expect(new URL(adminUrl).searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/admin/auth/youtube/callback',
    );
    expect(new URL(adminUrl).searchParams.get('state')).toBe('admin-state');
    expect(new URL(customerUrl).searchParams.get('redirect_uri')).toBe(
      'https://api.joinjubily.com/api/auth/youtube/callback',
    );
    expect(new URL(customerUrl).searchParams.get('state')).toBe(
      'customer-state',
    );

    const oauth2 = google.auth.OAuth2 as unknown as jest.Mock;
    expect(oauth2).toHaveBeenCalledWith(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      'https://api.example.com/admin/auth/youtube/callback',
    );
    expect(oauth2).toHaveBeenCalledWith(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      'https://api.joinjubily.com/api/auth/youtube/callback',
    );
  });

  it('falls back to legacy YOUTUBE_REDIRECT outside production only', () => {
    delete process.env.YOUTUBE_ADMIN_REDIRECT_URI;
    delete process.env.YOUTUBE_CUSTOMER_REDIRECT_URI;
    delete process.env.YOUTUBE_REDIRECT_URI;
    process.env.YOUTUBE_REDIRECT =
      'http://localhost:5000/auth/youtube/callback';
    process.env.NODE_ENV = 'development';
    const service = new YoutubeService(prisma as never);

    expect(() => service.getAdminAuthUrl('state-1')).not.toThrow();
    expect(google.auth.OAuth2).toHaveBeenLastCalledWith(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      'http://localhost:5000/auth/youtube/callback',
    );

    process.env.NODE_ENV = 'production';
    expect(() => service.getAdminAuthUrl('state-2')).toThrow(
      'YouTube OAuth is not configured',
    );
  });

  it('uses global YOUTUBE_REDIRECT_URI for workspace/customer OAuth when workspace redirect is missing', () => {
    delete process.env.YOUTUBE_CUSTOMER_REDIRECT_URI;
    process.env.NODE_ENV = 'production';
    const service = new YoutubeService(prisma as never);

    const url = service.getCustomerAuthUrl('workspace-state');

    expect(new URL(url).searchParams.get('redirect_uri')).toBe(
      'https://api.joinjubily.com/api/auth/youtube/callback',
    );
    expect(new URL(url).searchParams.get('state')).toBe('workspace-state');
    expect(google.auth.OAuth2).toHaveBeenLastCalledWith(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      'https://api.joinjubily.com/api/auth/youtube/callback',
    );
  });

  it('falls back to legacy split customer redirect only when global workspace redirect is missing', () => {
    delete process.env.YOUTUBE_REDIRECT_URI;
    process.env.NODE_ENV = 'production';
    const service = new YoutubeService(prisma as never);

    const url = service.getCustomerAuthUrl('workspace-state');

    expect(new URL(url).searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/workspaces/youtube/callback',
    );
    expect(new URL(url).searchParams.get('state')).toBe('workspace-state');
  });

  it('returns a friendly configuration error when global OAuth config is missing', () => {
    delete process.env.YOUTUBE_CLIENT_ID;
    const service = new YoutubeService(prisma as never);

    expect(() => service.getCustomerAuthUrl('workspace-state')).toThrow(
      'YouTube OAuth is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET.',
    );
  });

  it('stores YouTube OAuth tokens per workspace with channel metadata', async () => {
    process.env.SETTINGS_MASTER_KEY_BASE64 = Buffer.alloc(32, 7).toString(
      'base64',
    );
    const service = new YoutubeService(prisma as never);
    service.getAdminAuthUrl('state-1');
    const oauthResults = (google.auth.OAuth2 as unknown as jest.Mock).mock
      .results;
    const oauth = oauthResults[oauthResults.length - 1].value;
    oauth.getToken.mockResolvedValue({
      tokens: {
        access_token: 'workspace-access-token',
        refresh_token: 'workspace-refresh-token',
        scope: 'workspace-scope',
        expiry_date: 123,
      },
    });
    mockedGoogle.youtube.mockReturnValueOnce({
      channels: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'UC_WORKSPACE',
                snippet: {
                  title: 'Workspace Channel',
                  customUrl: '@workspace',
                },
              },
            ],
          },
        }),
      },
    });

    await expect(
      service.handleWorkspaceAuthCallback('workspace-1', 'oauth-code'),
    ).resolves.toEqual(
      expect.objectContaining({
        connected: true,
        channelId: 'UC_WORKSPACE',
        title: 'Workspace Channel',
      }),
    );

    expect(prisma.workspaceYoutubeConnection.upsert).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-1' },
      update: expect.objectContaining({
        channelId: 'UC_WORKSPACE',
        channelTitle: 'Workspace Channel',
        channelCustomUrl: '@workspace',
        scope: 'workspace-scope',
      }),
      create: expect.objectContaining({
        workspaceId: 'workspace-1',
        channelId: 'UC_WORKSPACE',
        channelTitle: 'Workspace Channel',
        channelCustomUrl: '@workspace',
        scope: 'workspace-scope',
      }),
    });
  });

  it('returns a disconnected diagnostics result instead of throwing when no token is configured', async () => {
    const service = new YoutubeService(prisma as never);

    await expect(service.getChannelDiagnostics()).resolves.toEqual({
      connected: false,
      channelId: null,
      title: null,
      customUrl: null,
      thumbnailUrl: null,
      selectedChannelId: null,
      currentChannel: null,
      channels: [],
      subscriberCount: null,
      videoCount: null,
      statistics: null,
      targetChannelId: null,
      channelMatchesTarget: null,
      scope: null,
      tokenStorage: {
        encryptedDbConfigured: false,
        encryptedDbUpdatedAt: null,
        legacyFilePresent: false,
        legacyFileWriteFallbackEnabled: false,
      },
      error: 'YouTube OAuth token is not configured',
    });
    expect(mockedGoogle.youtube).not.toHaveBeenCalled();
  });

  it('returns connected channel diagnostics with token storage details', async () => {
    const updatedAt = new Date('2026-06-03T10:00:00.000Z');
    prisma.integrationKey.findUnique.mockResolvedValue({ updatedAt });
    const service = serviceWithTokens({
      access_token: 'access-1',
      scope: 'scope-1 scope-2',
    });
    mockedGoogle.youtube.mockReturnValueOnce({
      channels: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'UC123',
                snippet: { title: 'Jubily Channel', customUrl: '@jubily' },
                statistics: {
                  viewCount: '1000',
                  subscriberCount: '50',
                  hiddenSubscriberCount: false,
                  videoCount: '12',
                },
              },
            ],
          },
        }),
      },
    });

    await expect(service.getChannelDiagnostics()).resolves.toEqual({
      connected: true,
      channelId: 'UC123',
      title: 'Jubily Channel',
      customUrl: '@jubily',
      thumbnailUrl: null,
      selectedChannelId: 'UC123',
      currentChannel: {
        id: 'UC123',
        title: 'Jubily Channel',
        thumbnail: null,
        customUrl: '@jubily',
        selected: true,
      },
      channels: [
        {
          id: 'UC123',
          title: 'Jubily Channel',
          thumbnail: null,
          customUrl: '@jubily',
          selected: true,
        },
      ],
      subscriberCount: '50',
      videoCount: '12',
      statistics: {
        viewCount: '1000',
        subscriberCount: '50',
        hiddenSubscriberCount: false,
        videoCount: '12',
      },
      targetChannelId: null,
      channelMatchesTarget: null,
      scope: 'scope-1 scope-2',
      tokenStorage: {
        encryptedDbConfigured: true,
        encryptedDbUpdatedAt: updatedAt,
        legacyFilePresent: false,
        legacyFileWriteFallbackEnabled: false,
      },
      error: null,
    });
    const youtubeClient = mockedGoogle.youtube.mock.results[0].value;
    expect(youtubeClient.channels.list).toHaveBeenCalledWith({
      mine: true,
      part: ['snippet', 'statistics'],
    });
  });

  it('returns multiple connected channels with one selected and no OAuth tokens', async () => {
    const service = serviceWithTokens({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      scope: 'scope-1',
    });
    mockedGoogle.youtube.mockReturnValueOnce({
      channels: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'UC_ONE',
                snippet: {
                  title: 'First Channel',
                  customUrl: '@first',
                  thumbnails: {
                    default: { url: 'https://img.example.com/one.jpg' },
                  },
                },
              },
              {
                id: 'UC_TWO',
                snippet: {
                  title: 'Second Channel',
                  customUrl: '@second',
                  thumbnails: {
                    medium: { url: 'https://img.example.com/two.jpg' },
                  },
                },
              },
            ],
          },
        }),
      },
    });

    const result = await service.getChannelDiagnostics();

    expect(result).toMatchObject({
      connected: true,
      selectedChannelId: 'UC_ONE',
      currentChannel: {
        id: 'UC_ONE',
        title: 'First Channel',
        thumbnail: 'https://img.example.com/one.jpg',
        customUrl: '@first',
        selected: true,
      },
      channels: [
        {
          id: 'UC_ONE',
          title: 'First Channel',
          thumbnail: 'https://img.example.com/one.jpg',
          customUrl: '@first',
          selected: true,
        },
        {
          id: 'UC_TWO',
          title: 'Second Channel',
          thumbnail: 'https://img.example.com/two.jpg',
          customUrl: '@second',
          selected: false,
        },
      ],
      error: null,
    });

    expect(JSON.stringify(result)).not.toContain('access-1');
    expect(JSON.stringify(result)).not.toContain('refresh-1');
  });

  it('returns a friendly channel fetch error without exposing tokens', async () => {
    const service = serviceWithTokens({
      access_token: 'secret-access-token',
      refresh_token: 'secret-refresh-token',
      scope: 'scope-1',
    });
    mockedGoogle.youtube.mockReturnValueOnce({
      channels: {
        list: jest
          .fn()
          .mockRejectedValue(
            new Error(
              'failed Bearer secret-access-token access_token=secret-access-token',
            ),
          ),
      },
    });

    const result = await service.getChannelDiagnostics();

    expect(result).toMatchObject({
      connected: false,
      channels: [],
      currentChannel: null,
      error: 'failed Bearer [REDACTED] access_token=[REDACTED]',
    });
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
    expect(JSON.stringify(result)).not.toContain('secret-refresh-token');
  });

  it('loads the stored encrypted OAuth token for channel diagnostics', async () => {
    process.env.SETTINGS_MASTER_KEY_BASE64 = Buffer.alloc(32, 7).toString(
      'base64',
    );
    const updatedAt = new Date('2026-06-03T10:00:00.000Z');
    const { encrypted } = encryptString(
      JSON.stringify({
        access_token: 'stored-access-token',
        refresh_token: 'stored-refresh-token',
        scope: 'stored-scope',
      }),
    );
    prisma.integrationKey.findUnique.mockImplementation(
      ({ select }: { select: Record<string, boolean> }) => {
        if (select.encrypted) return Promise.resolve({ encrypted });
        return Promise.resolve({ updatedAt });
      },
    );
    const service = new YoutubeService(prisma as never);
    mockedGoogle.youtube.mockReturnValueOnce({
      channels: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'UC_STORED',
                snippet: {
                  title: 'Stored Token Channel',
                  customUrl: '@stored',
                },
              },
            ],
          },
        }),
      },
    });

    await expect(service.getChannelDiagnostics()).resolves.toEqual(
      expect.objectContaining({
        connected: true,
        channelId: 'UC_STORED',
        title: 'Stored Token Channel',
        subscriberCount: null,
        videoCount: null,
        statistics: null,
        scope: 'stored-scope',
      }),
    );
    const oauthResults = (google.auth.OAuth2 as unknown as jest.Mock).mock
      .results;
    const oauth = oauthResults[oauthResults.length - 1].value;
    expect(oauth.setCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'stored-access-token',
        refresh_token: 'stored-refresh-token',
      }),
    );
    expect(google.youtube).toHaveBeenCalledWith({ version: 'v3', auth: oauth });
  });

  it('surfaces a channel target mismatch in diagnostics', async () => {
    process.env.YOUTUBE_TARGET_CHANNEL_ID = 'UC_TARGET';
    const service = serviceWithTokens({ access_token: 'access-1' });
    mockedGoogle.youtube.mockReturnValueOnce({
      channels: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'UC_WRONG',
                snippet: { title: 'Wrong Channel', customUrl: '@wrong' },
              },
            ],
          },
        }),
      },
    });

    await expect(service.getChannelDiagnostics()).resolves.toEqual(
      expect.objectContaining({
        connected: true,
        channelId: 'UC_WRONG',
        title: 'Wrong Channel',
        subscriberCount: null,
        videoCount: null,
        statistics: null,
        targetChannelId: 'UC_TARGET',
        channelMatchesTarget: false,
        error:
          'Connected YouTube channel does not match target channel UC_TARGET',
      }),
    );
  });

  it('refuses to persist OAuth credentials for the wrong target channel', async () => {
    process.env.YOUTUBE_TARGET_CHANNEL_ID = 'UC_TARGET';
    const service = new YoutubeService(prisma as never);
    service.getAdminAuthUrl('state-1');
    const oauthResults = (google.auth.OAuth2 as unknown as jest.Mock).mock
      .results;
    const oauth = oauthResults[oauthResults.length - 1].value;
    oauth.getToken.mockResolvedValue({
      tokens: {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        scope: 'scope-1',
      },
    });
    mockedGoogle.youtube.mockReturnValueOnce({
      channels: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'UC_WRONG',
                snippet: { title: 'Wrong Channel' },
              },
            ],
          },
        }),
      },
    });

    await expect(service.handleAuthCallback('code-1')).rejects.toThrow(
      'does not match target channel UC_TARGET',
    );
    expect(prisma.integrationKey.upsert).not.toHaveBeenCalled();
  });

  it('blocks upload before downloading video when the connected channel is not the target', async () => {
    process.env.YOUTUBE_TARGET_CHANNEL_ID = 'UC_TARGET';
    const service = serviceWithTokens({ access_token: 'access-1' });
    mockedGoogle.youtube.mockReturnValueOnce({
      channels: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'UC_WRONG',
                snippet: { title: 'Wrong Channel' },
              },
            ],
          },
        }),
      },
    });

    await expect(
      service.upload(
        'Title',
        'Description',
        'https://cdn.example.com/video.mp4',
        [],
      ),
    ).rejects.toThrow('does not match target channel UC_TARGET');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
