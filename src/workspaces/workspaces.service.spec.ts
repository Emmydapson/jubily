import { ConflictException, ForbiddenException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    workspace: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
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
      user: { findUnique: jest.fn() },
      workspace: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
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

    await service.createWorkspace('user-1', {
      name: 'Acme Team',
      countryCode: 'us',
      countryName: 'United States',
      affiliateNiches: ['ai-software'],
      affiliatePlatforms: ['partnerstack', 'amazon'],
    });

    expect(prisma.workspace.create).toHaveBeenCalledWith({
      data: {
        name: 'Acme Team',
        slug: 'acme-team',
        ownerId: 'user-1',
        countryCode: 'US',
        countryName: 'United States',
        affiliateNiches: ['AI_SOFTWARE'],
        affiliatePlatforms: ['PARTNERSTACK', 'AMAZON_ASSOCIATES'],
        primaryAffiliateLink: null,
        affiliateLinks: undefined,
        preferredContentTone: null,
        preferredLanguage: null,
        targetAudience: null,
        contentGoal: null,
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
      expect.objectContaining({
        id: 'workspace-1',
        name: 'One',
        role: 'OWNER',
        affiliateNiches: [],
        affiliatePlatforms: [],
        onboardingComplete: false,
      }),
    ]);
    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('returns an empty workspace list clearly for newly verified users without memberships', async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({ id: 'fresh-user-1', name: 'Fresh', emailVerified: false });

    await expect(service.listMine('fresh-user-1')).resolves.toEqual([]);
  });

  it('recovers a default workspace when a verified legacy user lists workspaces with no memberships', async () => {
    prisma.workspaceMember.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          role: 'OWNER',
          workspace: { id: 'workspace-1', name: "Fresh's Workspace", slug: 'fresh-s-workspace-fresh-us' },
        },
      ]);
    prisma.user.findUnique.mockResolvedValue({ id: 'fresh-user-1', name: 'Fresh User', emailVerified: true });
    prisma.workspace.create.mockResolvedValue({
      id: 'workspace-1',
      name: "Fresh's Workspace",
      slug: 'fresh-s-workspace-fresh-us',
      ownerId: 'fresh-user-1',
      members: [{ role: 'OWNER' }],
    });

    await expect(service.listMine('fresh-user-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'workspace-1',
        name: "Fresh's Workspace",
        slug: 'fresh-s-workspace-fresh-us',
        role: 'OWNER',
        onboardingComplete: false,
      }),
    ]);

    expect(prisma.workspace.create).toHaveBeenCalledWith({
      data: {
        name: "Fresh's Workspace",
        slug: 'fresh-s-workspace-fresh-us',
        ownerId: 'fresh-user-1',
        members: {
          create: {
            userId: 'fresh-user-1',
            role: 'OWNER',
          },
        },
      },
      include: { members: { where: { userId: 'fresh-user-1' }, select: { role: true } } },
    });
  });

  it('does not duplicate a workspace on repeated workspace list calls when membership exists', async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        role: 'OWNER',
        workspace: { id: 'workspace-1', name: 'Existing Workspace', slug: 'existing-workspace' },
      },
    ]);

    await service.listMine('user-1');
    await service.listMine('user-1');

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.workspace.create).not.toHaveBeenCalled();
  });

  it('lets an existing zero-workspace user create their first workspace', async () => {
    prisma.workspace.create.mockResolvedValue({
      id: 'workspace-1',
      name: 'Fresh Workspace',
      slug: 'fresh-workspace',
      ownerId: 'fresh-user-1',
      members: [{ role: 'OWNER' }],
    });

    await expect(
      service.createWorkspace('fresh-user-1', { name: 'Fresh Workspace', countryCode: 'NG', countryName: 'Nigeria' }),
    ).resolves.toMatchObject({
      id: 'workspace-1',
      slug: 'fresh-workspace',
    });

    expect(prisma.workspace.create).toHaveBeenCalledWith({
      data: {
        name: 'Fresh Workspace',
        slug: 'fresh-workspace',
        ownerId: 'fresh-user-1',
        countryCode: 'NG',
        countryName: 'Nigeria',
        affiliateNiches: [],
        affiliatePlatforms: [],
        primaryAffiliateLink: null,
        affiliateLinks: undefined,
        preferredContentTone: null,
        preferredLanguage: null,
        targetAudience: null,
        contentGoal: null,
        members: {
          create: {
            userId: 'fresh-user-1',
            role: 'OWNER',
          },
        },
      },
      include: { members: { where: { userId: 'fresh-user-1' }, select: { role: true } } },
    });
  });

  it('maps duplicate workspace slug errors to a clean conflict response', async () => {
    prisma.workspace.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.createWorkspace('user-1', { name: 'Acme Team', countryCode: 'US', countryName: 'United States' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('updates affiliate onboarding profile and keeps legacy profiles readable', async () => {
    prisma.workspace.findUnique.mockResolvedValueOnce({ id: 'workspace-1' });
    prisma.workspace.update.mockResolvedValue({
      id: 'workspace-1',
      name: 'Acme',
      slug: 'acme',
      countryCode: 'GB',
      countryName: 'United Kingdom',
      affiliateNiches: ['FINANCE'],
      affiliatePlatforms: ['CJ_AFFILIATE', 'IMPACT'],
      primaryAffiliateLink: 'https://example.com',
      affiliateLinks: { CJ_AFFILIATE: 'https://example.com' },
      preferredContentTone: 'Practical',
      preferredLanguage: 'en',
      targetAudience: 'new investors',
      contentGoal: 'compare tools',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.updateProfile('workspace-1', {
        countryCode: 'gb',
        countryName: 'United Kingdom',
        affiliateNiches: ['finance'],
        affiliatePlatforms: ['cj', 'impact'],
        primaryAffiliateLink: 'https://example.com',
        affiliateLinks: { CJ_AFFILIATE: 'https://example.com' },
        preferredContentTone: 'Practical',
        preferredLanguage: 'en',
        targetAudience: 'new investors',
        contentGoal: 'compare tools',
      }),
    ).resolves.toMatchObject({
      countryCode: 'GB',
      affiliateNiches: ['FINANCE'],
      affiliatePlatforms: ['CJ_AFFILIATE', 'IMPACT'],
      onboardingComplete: true,
    });

    prisma.workspace.findUnique.mockResolvedValueOnce({
      id: 'legacy-workspace',
      name: 'Legacy',
      slug: 'legacy',
      countryCode: null,
      countryName: null,
      affiliateNiches: [],
      affiliatePlatforms: [],
    });

    await expect(service.getProfile('legacy-workspace')).resolves.toMatchObject({
      countryCode: null,
      countryName: null,
      affiliateNiches: [],
      affiliatePlatforms: [],
      onboardingComplete: false,
    });
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
