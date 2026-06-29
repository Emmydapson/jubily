import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { AdminGuard } from './admin.guard';

describe('RBAC and JWT validation', () => {
  function contextFor(user?: { role?: string; kind?: 'admin' | 'user'; adminId?: string; userId?: string }) {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    };
  }

  it('allows public routes before role checks', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValueOnce(true),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(contextFor({ role: 'USER' }) as never)).toBe(true);
  });

  it('allows matching roles and rejects missing or insufficient roles', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(['ADMIN'])
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(['ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(contextFor({ role: 'ADMIN', kind: 'admin', adminId: 'admin-1' }) as never)).toBe(true);
    expect(() => guard.canActivate(contextFor({ role: 'EDITOR' }) as never)).toThrow(
      ForbiddenException,
    );
  });

  it('rejects customer principals from admin routes and accepts admin principals', () => {
    const guard = new AdminGuard();
    expect(() => guard.canActivate(contextFor({ role: 'USER', kind: 'user', userId: 'user-1' }) as never)).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(contextFor({ role: 'SUPPORT', kind: 'admin', adminId: 'admin-1' }) as never)).toBe(true);
  });

  it('hydrates active admins from JWT payloads and rejects missing or inactive users', async () => {
    const prisma = {
      adminUser: {
        findUnique: jest.fn().mockResolvedValueOnce({
          id: 'admin-1',
          email: 'admin@joinjubily.com',
          role: 'ADMIN',
          active: true,
        }),
      },
      user: { findUnique: jest.fn() },
    };
    const strategy = new JwtStrategy(prisma as never);

    await expect(strategy.validate({ sub: 'admin-1', kind: 'admin' })).resolves.toEqual({
      adminId: 'admin-1',
      email: 'admin@joinjubily.com',
      role: 'ADMIN',
      kind: 'admin',
    });

    await expect(strategy.validate({ sub: 'admin-1' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate({})).rejects.toBeInstanceOf(UnauthorizedException);

    prisma.adminUser.findUnique.mockResolvedValueOnce({
      id: 'admin-2',
      email: 'disabled@joinjubily.com',
      role: 'ADMIN',
      active: false,
    });
    await expect(strategy.validate({ sub: 'admin-2' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('blocks unverified SaaS users from workspace-scoped actions', async () => {
    const prisma = {
      workspaceMember: { findUnique: jest.fn() },
    };
    const reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as Reflector;
    const audit = { record: jest.fn().mockResolvedValue(null) };
    const guard = new WorkspaceGuard(prisma as never, reflector, audit as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-workspace-id': 'workspace-1' },
          query: {},
          params: {},
          body: {},
          user: {
            userId: 'user-1',
            email: 'user@example.com',
            role: 'USER',
            kind: 'user',
            emailVerified: false,
          },
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    };

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PERMISSION_DENIED',
      metadata: { reason: 'email_not_verified' },
    }));
  });

  it('does not allow admin tokens to satisfy workspace-scoped guards', async () => {
    const prisma = {
      workspaceMember: { findUnique: jest.fn() },
    };
    const reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as Reflector;
    const audit = { record: jest.fn().mockResolvedValue(null) };
    const guard = new WorkspaceGuard(prisma as never, reflector, audit as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-workspace-id': 'workspace-1' },
          query: {},
          params: {},
          body: {},
          user: {
            adminId: 'admin-1',
            email: 'admin@example.com',
            role: 'ADMIN',
            kind: 'admin',
          },
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    };

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
  });

  it('allows customer tokens through workspace guard after membership checks', async () => {
    const prisma = {
      workspaceMember: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'MEMBER',
          workspace: { suspended: false, suspensionReason: null },
        }),
      },
    };
    const reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as Reflector;
    const audit = { record: jest.fn().mockResolvedValue(null) };
    const guard = new WorkspaceGuard(prisma as never, reflector, audit as never);
    const req = {
      headers: { 'x-workspace-id': 'workspace-1' },
      query: {},
      params: {},
      body: {},
      user: {
        userId: 'user-1',
        email: 'user@example.com',
        role: 'USER',
        kind: 'user',
        emailVerified: true,
      },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    };

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(req).toHaveProperty('workspace', { id: 'workspace-1', role: 'MEMBER' });
  });

  it('rejects mismatched route and header workspace ids before membership lookup', async () => {
    const prisma = {
      workspaceMember: { findUnique: jest.fn() },
    };
    const reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as Reflector;
    const audit = { record: jest.fn().mockResolvedValue(null) };
    const guard = new WorkspaceGuard(prisma as never, reflector, audit as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-workspace-id': 'workspace-header' },
          query: {},
          params: { workspaceId: 'workspace-route' },
          body: {},
          user: {
            userId: 'user-1',
            email: 'user@example.com',
            role: 'USER',
            kind: 'user',
            emailVerified: true,
          },
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    };

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
  });
});
