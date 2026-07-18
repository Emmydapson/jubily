import { EmailOutboxWorker } from './email-outbox.worker';

describe('EmailOutboxWorker', () => {
  it('retries due failed and pending emails', async () => {
    const now = new Date('2026-06-28T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const rows = [
      {
        id: 'email-1',
        userId: 'user-1',
        to: 'user@example.com',
        type: 'verification',
        subject: 'Subject',
        text: 'Text',
        html: '<p>Text</p>',
        attempts: 1,
      },
    ];
    const prisma = {
      emailOutbox: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };
    const emails = {
      retryOutboxEmail: jest.fn().mockResolvedValue({ sent: true }),
    };
    const worker = new EmailOutboxWorker(prisma as never, emails as never);

    await worker.processDueEmails();

    expect(prisma.emailOutbox.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        attempts: { lt: 5 },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    expect(emails.retryOutboxEmail).toHaveBeenCalledWith(rows[0], 5);
    jest.useRealTimers();
  });
});
