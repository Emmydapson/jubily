import { WorkspaceYoutubeOAuthController } from './youtube-oauth.controller';

describe('WorkspaceYoutubeOAuthController', () => {
  let workspaces: {
    requireMembership: jest.Mock;
    recordYoutubeConnected: jest.Mock;
  };
  let youtube: {
    handleWorkspaceAuthCallback: jest.Mock;
  };
  let oauthStates: {
    consume: jest.Mock;
  };
  let controller: WorkspaceYoutubeOAuthController;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://joinjubily.com';
    workspaces = {
      requireMembership: jest.fn().mockResolvedValue({ role: 'OWNER' }),
      recordYoutubeConnected: jest.fn().mockResolvedValue(undefined),
    };
    youtube = {
      handleWorkspaceAuthCallback: jest.fn().mockResolvedValue({
        connected: true,
        channelId: 'UC_WORKSPACE',
        title: 'Workspace Channel',
      }),
    };
    oauthStates = {
      consume: jest.fn().mockResolvedValue({
        purpose: 'workspace_youtube',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
    };
    controller = new WorkspaceYoutubeOAuthController(
      workspaces as never,
      youtube as never,
      oauthStates as never,
    );
  });

  function responseMock() {
    return {
      redirect: jest.fn().mockReturnThis(),
    };
  }

  it('stores the workspace token and redirects to the frontend success URL', async () => {
    const res = responseMock();

    await controller.callback(res as never, 'code-1', 'state-1');

    expect(oauthStates.consume).toHaveBeenCalledWith('workspace_youtube', 'state-1');
    expect(workspaces.requireMembership).toHaveBeenCalledWith('workspace-1', 'user-1', ['OWNER', 'ADMIN']);
    expect(youtube.handleWorkspaceAuthCallback).toHaveBeenCalledWith('workspace-1', 'code-1', 'user-1');
    expect(workspaces.recordYoutubeConnected).toHaveBeenCalledWith('workspace-1', 'user-1', {
      connected: true,
      channelId: 'UC_WORKSPACE',
      title: 'Workspace Channel',
    });
    expect(res.redirect).toHaveBeenCalledWith('https://joinjubily.com/youtube?connected=true');
  });

  it('redirects invalid callback state with a frontend-safe error code', async () => {
    oauthStates.consume.mockResolvedValueOnce(null);
    const res = responseMock();

    await controller.callback(res as never, 'code-1', 'bad-state');

    expect(youtube.handleWorkspaceAuthCallback).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('https://joinjubily.com/youtube?error=INVALID_CALLBACK_STATE');
  });
});
