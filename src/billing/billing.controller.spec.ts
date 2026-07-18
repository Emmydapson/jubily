import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { WORKSPACE_ROLES_KEY } from '../workspaces/workspace-roles.decorator';
import { BillingController } from './billing.controller';

describe('BillingController workspace roles', () => {
  it('restricts checkout and cancel to workspace owners/admins', () => {
    expect(
      Reflect.getMetadata(
        WORKSPACE_ROLES_KEY,
        BillingController.prototype.startCheckout,
      ),
    ).toEqual(['OWNER', 'ADMIN']);
    expect(
      Reflect.getMetadata(
        WORKSPACE_ROLES_KEY,
        BillingController.prototype.cancel,
      ),
    ).toEqual(['OWNER', 'ADMIN']);
  });

  it('keeps plan listing public for pre-login pricing pages', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, BillingController.prototype.plans),
    ).toBe(true);
  });

  it('keeps provider webhooks available at singular and plural paths', () => {
    expect(
      Reflect.getMetadata('path', BillingController.prototype.providerWebhook),
    ).toBe('webhook/:provider');
    expect(
      Reflect.getMetadata('path', BillingController.prototype.providerWebhooks),
    ).toBe('webhooks/:provider');
  });

  it('verifies Paystack callbacks from reference or trxref', async () => {
    const billing = {
      verifyPaystackCallback: jest.fn().mockResolvedValue({ verified: true }),
    };
    const controller = new BillingController(billing as never);

    await expect(controller.paystackCallback('ref-1')).resolves.toEqual({
      verified: true,
    });
    await expect(
      controller.paystackCallback(undefined, 'trx-1'),
    ).resolves.toEqual({ verified: true });

    expect(billing.verifyPaystackCallback).toHaveBeenNthCalledWith(1, 'ref-1');
    expect(billing.verifyPaystackCallback).toHaveBeenNthCalledWith(2, 'trx-1');
  });
});
