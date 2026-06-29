import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  it('scopes click and conversion analytics to workspace when provided', async () => {
    const prisma = {
      click: { findMany: jest.fn().mockResolvedValue([]) },
      conversion: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AnalyticsService(prisma as never);

    await service.weekly({ days: 7, timeZone: 'UTC', workspaceId: 'workspace-1' });

    expect(prisma.click.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace-1' }),
      }),
    );
    expect(prisma.conversion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace-1' }),
      }),
    );
  });
});
