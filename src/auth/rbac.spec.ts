import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';

describe('RBAC and JWT validation', () => {
  function contextFor(user?: { role?: string }) {
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

    expect(guard.canActivate(contextFor({ role: 'ADMIN' }) as never)).toBe(true);
    expect(() => guard.canActivate(contextFor({ role: 'EDITOR' }) as never)).toThrow(
      ForbiddenException,
    );
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
    };
    const strategy = new JwtStrategy(prisma as never);

    await expect(strategy.validate({ sub: 'admin-1' })).resolves.toEqual({
      adminId: 'admin-1',
      email: 'admin@joinjubily.com',
      role: 'ADMIN',
    });

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
});
