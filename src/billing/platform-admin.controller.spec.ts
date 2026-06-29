import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PlatformAdminController } from './platform-admin.controller';

describe('PlatformAdminController', () => {
  it('is restricted to platform admins', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, PlatformAdminController);
    expect(roles).toEqual(['ADMIN']);

    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(roles),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: 'USER' } }),
      }),
    };

    expect(() => guard.canActivate(context as never)).toThrow('Insufficient role');
  });
});
