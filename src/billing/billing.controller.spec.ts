import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { WORKSPACE_ROLES_KEY } from '../workspaces/workspace-roles.decorator';
import { BillingController } from './billing.controller';

describe('BillingController workspace roles', () => {
  it('restricts checkout and cancel to workspace owners/admins', () => {
    expect(Reflect.getMetadata(WORKSPACE_ROLES_KEY, BillingController.prototype.startCheckout)).toEqual([
      'OWNER',
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(WORKSPACE_ROLES_KEY, BillingController.prototype.cancel)).toEqual([
      'OWNER',
      'ADMIN',
    ]);
  });

  it('keeps plan listing public for pre-login pricing pages', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, BillingController.prototype.plans)).toBe(true);
  });
});
