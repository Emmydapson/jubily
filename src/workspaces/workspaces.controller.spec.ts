import { BadRequestException } from '@nestjs/common';
import { YoutubeOAuthError } from '../common/youtube.service';
import { WorkspacesController } from './workspaces.controller';

describe('WorkspacesController YouTube OAuth flow', () => {
  let workspaces: {
    requireMembership: jest.Mock;
    recordYoutubeConnected: jest.Mock;
  };
  let youtube: {
    getCustomerAuthUrl: jest.Mock;
    handleWorkspaceAuthCallback: jest.Mock;
  };
  let oauthStates: {
    create: jest.Mock;
    consume: jest.Mock;
  };
  let controller: WorkspacesController;

  const req = {
    user: {
      userId: 'user-1',
      kind: 'user',
    },
  };
  const workspace = { id: 'workspace-1' };

  beforeEach(() => {
    workspaces = {
      requireMembership: jest.fn().mockResolvedValue({ role: 'OWNER' }),
      recordYoutubeConnected: jest.fn().mockResolvedValue(undefined),
    };
    youtube = {
      getCustomerAuthUrl: jest.fn((state: string) => `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent('https://api.joinjubily.com/api/auth/youtube/callback')}&state=${encodeURIComponent(state)}`),
      handleWorkspaceAuthCallback: jest.fn().mockResolvedValue({ connected: true, channelId: 'UC_WORKSPACE' }),
    };
    oauthStates = {
      create: jest.fn().mockResolvedValue('workspace-state-1'),
      consume: jest.fn().mockResolvedValue({
        purpose: 'workspace_youtube',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
    };

    controller = new WorkspacesController(workspaces as never, youtube as never, oauthStates as never);
  });

  function responseMock() {
    return {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
    };
  }

  it('customer connect returns a Google OAuth URL with the global customer callback redirect', async () => {
    const result = await controller.youtubeConnect(req as never, workspace);
    const url = new URL(result.url);

    expect(url.searchParams.get('redirect_uri')).toBe('https://api.joinjubily.com/api/auth/youtube/callback');
    expect(url.searchParams.get('state')).toBe('workspace-state-1');
    expect(youtube.getCustomerAuthUrl).toHaveBeenCalledWith('workspace-state-1');
    expect(oauthStates.create).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'workspace_youtube',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    }));
  });

  it('customer connect returns a friendly config error when OAuth is missing', async () => {
    youtube.getCustomerAuthUrl.mockImplementationOnce(() => {
      throw new YoutubeOAuthError('YOUTUBE_OAUTH_NOT_CONFIGURED', 'YouTube OAuth is not configured.');
    });

    await expect(controller.youtubeConnect(req as never, workspace)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('customer callback validates workspace_youtube state before storing credentials', async () => {
    const res = responseMock();

    await controller.youtubeCallback(res as never, 'code-1', 'workspace-state-1');

    expect(oauthStates.consume).toHaveBeenCalledWith('workspace_youtube', 'workspace-state-1');
    expect(workspaces.requireMembership).toHaveBeenCalledWith('workspace-1', 'user-1', ['OWNER', 'ADMIN']);
    expect(youtube.handleWorkspaceAuthCallback).toHaveBeenCalledWith('workspace-1', 'code-1', 'user-1');
    expect(workspaces.recordYoutubeConnected).toHaveBeenCalledWith('workspace-1', 'user-1', {
      connected: true,
      channelId: 'UC_WORKSPACE',
    });
    expect(res.redirect).toHaveBeenCalledWith('https://joinjubily.com/youtube?connected=true');
  });

  it('customer callback redirects invalid workspace_youtube state with a friendly error code', async () => {
    oauthStates.consume.mockResolvedValueOnce(null);
    const res = responseMock();

    await controller.youtubeCallback(res as never, 'code-1', 'bad-state');

    expect(oauthStates.consume).toHaveBeenCalledWith('workspace_youtube', 'bad-state');
    expect(youtube.handleWorkspaceAuthCallback).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('https://joinjubily.com/youtube?error=INVALID_CALLBACK_STATE');
  });
});
