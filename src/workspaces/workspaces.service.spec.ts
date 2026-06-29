import { ForbiddenException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService', () => {
  let prisma: {
    workspace: { create: jest.Mock; findUnique: jest.Mock };
    workspaceMember: { findMany: jest.Mock; findUnique: jest.Mock };
    offer: { count: jest.Mock };
    topic: { count: jest.Mock };
    script: { count: jest.Mock };
    videoJob: { count: jest.Mock };
  };
  let youtube: { getWorkspaceChannelDiagnostics: jest.Mock; disconnectWorkspace: jest.Mock };
  let audit: { record: jest.Mock };
  let service: WorkspacesService;

  beforeEach(() => {
    prisma = {
      workspace: { create: jest.fn(), findUnique: jest.fn() },
      workspaceMember: { findMany: jest.fn(), findUnique: jest.fn() },
      offer: { count: jest.fn() },
      topic: { count: jest.fn() },
      script: { count: jest.fn() },
      videoJob: { count: jest.fn() },
    };
    youtube = {
      getWorkspaceChannelDiagnostics: jest.fn().mockResolvedValue({ connected: false }),
      disconnectWorkspace: jest.fn(),
    };
    audit = { record: jest.fn().mockResolvedValue(null) };
    service = new WorkspacesService(prisma as never, youtube as never, audit as never);
  });

  it('creates an owner membership when creating a workspace', async () => {
    prisma.workspace.create.mockResolvedValue({ id: 'workspace-1', name: 'Acme' });

    await service.createWorkspace('user-1', { name: 'Acme Team' });

    expect(prisma.workspace.create).toHaveBeenCalledWith({
      data: {
        name: 'Acme Team',
        slug: 'acme-team',
        ownerId: 'user-1',
        members: {
          create: {
            userId: 'user-1',
            role: 'OWNER',
          },
        },
      },
      include: { members: { where: { userId: 'user-1' }, select: { role: true } } },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'WORKSPACE_CREATED',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    }));
  });

  it('lists only workspaces where the user is a member', async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([
      { role: 'OWNER', workspace: { id: 'workspace-1', name: 'One' } },
    ]);

    await expect(service.listMine('user-1')).resolves.toEqual([
      { id: 'workspace-1', name: 'One', role: 'OWNER' },
    ]);
    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('blocks non-members and allows owners/admins for YouTube ownership actions', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue(null);
    await expect(
      service.requireMembership('workspace-1', 'user-2', ['OWNER', 'ADMIN']),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.workspaceMember.findUnique.mockResolvedValue({
      role: 'MEMBER',
      workspace: { id: 'workspace-1' },
    });
    await expect(
      service.requireMembership('workspace-1', 'user-1', ['OWNER', 'ADMIN']),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.workspaceMember.findUnique.mockResolvedValue({
      role: 'ADMIN',
      workspace: { id: 'workspace-1' },
    });
    await expect(
      service.requireMembership('workspace-1', 'user-1', ['OWNER', 'ADMIN']),
    ).resolves.toMatchObject({ role: 'ADMIN' });
  });
});
