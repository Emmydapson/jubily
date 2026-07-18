import { WORKSPACE_ROLES_KEY } from './workspace-roles.decorator';
import { ForbiddenException } from '@nestjs/common';
import { OffersController } from '../offers/offers.controller';
import { AutomationController } from '../automation/automation.controller';
import { VideosController } from '../automation/videos/videos.controller';
import { AdminVideosController } from '../automation/videos/admin-videos.controller';
import { WorkspacesController } from './workspaces.controller';
import { BillingController } from '../billing/billing.controller';
import { WorkspaceGuard } from './workspace.guard';

describe('workspace high-impact role restrictions', () => {
  const ownerAdmin = ['OWNER', 'ADMIN'];

  function expectOwnerAdmin(target: object, method: string) {
    expect(
      Reflect.getMetadata(
        WORKSPACE_ROLES_KEY,
        (target as Record<string, any>)[method],
      ),
    ).toEqual(ownerAdmin);
  }

  it('restricts offer mutations to owners/admins', () => {
    expectOwnerAdmin(OffersController.prototype, 'create');
    expectOwnerAdmin(OffersController.prototype, 'update');
    expectOwnerAdmin(OffersController.prototype, 'deactivate');
    expectOwnerAdmin(OffersController.prototype, 'reactivate');
  });

  it('restricts script edits and review decisions to owners/admins', () => {
    expectOwnerAdmin(AutomationController.prototype, 'updateScript');
    expectOwnerAdmin(
      AutomationController.prototype,
      'updateScriptReviewStatus',
    );
    expectOwnerAdmin(AutomationController.prototype, 'reReviewScript');
  });

  it('keeps operator video mutations out of the customer video controller', () => {
    const prototype = VideosController.prototype as unknown as Record<
      string,
      unknown
    >;
    expect(prototype.register).toBeUndefined();
    expect(prototype.markPublished).toBeUndefined();
    expect(prototype.markFailed).toBeUndefined();
  });

  it('restricts video publish mutations to owners/admins and moves operator mutations to admin routes', () => {
    expectOwnerAdmin(VideosController.prototype, 'create');
    expectOwnerAdmin(VideosController.prototype, 'publish');
    expect(AdminVideosController.prototype.register).toBeDefined();
    expect(AdminVideosController.prototype.markPublished).toBeDefined();
    expect(AdminVideosController.prototype.markFailed).toBeDefined();
    expect(AdminVideosController.prototype.createVideo).toBeDefined();
  });

  it('restricts YouTube connection and billing mutations to owners/admins', () => {
    expectOwnerAdmin(WorkspacesController.prototype, 'youtubeConnect');
    expectOwnerAdmin(WorkspacesController.prototype, 'disconnectYoutube');
    expectOwnerAdmin(BillingController.prototype, 'startCheckout');
    expectOwnerAdmin(BillingController.prototype, 'cancel');
  });

  it('rejects x-workspace-id when it conflicts with a route workspaceId', async () => {
    const guard = new WorkspaceGuard(
      {} as never,
      { getAllAndOverride: jest.fn() } as never,
      { record: jest.fn() } as never,
    );
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: 'user-1', emailVerified: true },
          headers: { 'x-workspace-id': 'workspace-header' },
          params: { workspaceId: 'workspace-route' },
          query: {},
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    };

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects workspace members from owner/admin-only video creation routes', async () => {
    const prisma = {
      workspaceMember: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'MEMBER',
          workspace: { suspended: false, suspensionReason: null },
        }),
      },
    };
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['OWNER', 'ADMIN']),
    };
    const audit = { record: jest.fn().mockResolvedValue(null) };
    const guard = new WorkspaceGuard(
      prisma as never,
      reflector as never,
      audit as never,
    );
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { kind: 'user', userId: 'user-1', emailVerified: true },
          headers: { 'x-workspace-id': 'workspace-1' },
          params: {},
          query: {},
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    };

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PERMISSION_DENIED',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        metadata: expect.objectContaining({
          reason: 'insufficient_workspace_role',
          role: 'MEMBER',
        }),
      }),
    );
  });
});
