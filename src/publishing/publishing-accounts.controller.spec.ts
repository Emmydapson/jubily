import { PublishingAccountsController } from './publishing-accounts.controller';

describe('PublishingAccountsController', () => {
  let accounts: any;
  let controller: PublishingAccountsController;

  beforeEach(() => {
    accounts = {
      listAccounts: jest.fn().mockResolvedValue([{ id: 'account-1', provider: 'TIKTOK' }]),
      selectAccount: jest.fn().mockResolvedValue({ id: 'account-1', selectedPageId: 'page-1' }),
      disconnectAccount: jest.fn().mockResolvedValue({ id: 'account-1', status: 'DISCONNECTED' }),
    };
    controller = new PublishingAccountsController(accounts);
  });

  it('lists publishing accounts for the active workspace', async () => {
    await expect(controller.list({ id: 'workspace-1' })).resolves.toEqual([{ id: 'account-1', provider: 'TIKTOK' }]);
    expect(accounts.listAccounts).toHaveBeenCalledWith('workspace-1');
  });

  it('selects a page/account scoped to the active workspace', async () => {
    await expect(controller.select('account-1', { selectedPageId: 'page-1' }, { user: { userId: 'user-1' } } as any, { id: 'workspace-1' }))
      .resolves.toEqual({ id: 'account-1', selectedPageId: 'page-1' });
    expect(accounts.selectAccount).toHaveBeenCalledWith('workspace-1', 'account-1', { selectedPageId: 'page-1' }, 'user-1');
  });

  it('disconnects a publishing account scoped to the active workspace', async () => {
    await expect(controller.disconnect('account-1', { user: { userId: 'user-1' } } as any, { id: 'workspace-1' }))
      .resolves.toEqual({ id: 'account-1', status: 'DISCONNECTED' });
    expect(accounts.disconnectAccount).toHaveBeenCalledWith('workspace-1', 'account-1', 'user-1');
  });
});
