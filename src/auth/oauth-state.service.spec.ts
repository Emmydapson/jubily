import { OAuthStateService } from './oauth-state.service';

describe('OAuthStateService', () => {
  let prisma: {
    oAuthState: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let service: OAuthStateService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-27T12:00:00.000Z'));
    prisma = {
      oAuthState: {
        create: jest.fn().mockResolvedValue({ id: 'state-1' }),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    service = new OAuthStateService(prisma as never);
  });

  afterEach(() => jest.useRealTimers());

  it('stores only a hashed state and consumes it once', async () => {
    const state = await service.create({
      purpose: 'workspace_youtube',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      ttlMs: 600_000,
    });

    expect(state).toEqual(expect.any(String));
    expect(prisma.oAuthState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stateHash: expect.not.stringContaining(state),
        purpose: 'workspace_youtube',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        expiresAt: new Date('2026-06-27T12:10:00.000Z'),
      }),
    });

    prisma.oAuthState.findUnique.mockResolvedValue({
      id: 'state-1',
      stateHash: 'hash',
      purpose: 'workspace_youtube',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      adminId: null,
      adminEmail: null,
      expiresAt: new Date('2026-06-27T12:10:00.000Z'),
      usedAt: null,
      createdAt: new Date(),
    });
    prisma.oAuthState.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(
      service.consume('workspace_youtube', state),
    ).resolves.toMatchObject({
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });
    await expect(
      service.consume('workspace_youtube', state),
    ).resolves.toBeNull();
  });
});
