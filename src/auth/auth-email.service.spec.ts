import nodemailer from 'nodemailer';
import { AuthEmailService } from './auth-email.service';
import {
  passwordChangedEmailTemplate,
  passwordResetEmailTemplate,
  verificationEmailTemplate,
} from './email-templates';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

describe('account email templates', () => {
  it('generates verification, reset, and password changed templates', () => {
    const verification = verificationEmailTemplate({
      name: 'Jane',
      url: 'https://app.test/verify',
    });
    expect(verification).toEqual(
      expect.objectContaining({
        subject: 'Verify your Jubily email',
        text: expect.stringContaining('https://app.test/verify'),
        html: expect.stringContaining('Verify email'),
      }),
    );
    expect(verification.html).toContain('#FFFDF7');
    expect(verification.html).toContain('#FFFFFF');
    expect(verification.html).toContain('#2B211D');
    expect(verification.html).toContain('#5F4A3F');
    expect(verification.html).toContain('#D99A29');
    expect(verification.html).toContain('#E8D8C6');
    expect(verification.html).toContain('#1F766E');
    expect(verification.html).not.toContain('#B94A48');
    expect(verification.html).not.toMatch(
      /#(?:ff6b6b|ff7f50|ff5a5f|e85d75|ef4444|dc2626)/i,
    );
    expect(verification.html).toContain('Jubily');
    expect(verification.html).not.toContain('Oneverse');
    expect(verification.text).not.toContain('Oneverse');
    expect(verification.html).toContain(
      'Contact: <a href="mailto:info@joinjubily.com"',
    );
    expect(verification.text).toContain('info@joinjubily.com');
    expect(verification.html).toContain('If the button does not work');
    expect(verification.html).toContain('https://app.test/verify');
    expect(verification.html).not.toMatch(/^<p>/);

    const reset = passwordResetEmailTemplate({
      name: 'Jane',
      url: 'https://app.test/reset',
    });
    expect(reset.text).toContain('https://app.test/reset');
    expect(reset.html).toContain('#FFFDF7');
    expect(reset.html).toContain('Reset password');
    expect(reset.html).toContain('If the button does not work');
    expect(reset.html).not.toContain('#B94A48');

    const changed = passwordChangedEmailTemplate('Jane');
    expect(changed.subject).toBe('Your Jubily password was changed');
    expect(changed.text).toContain('Your Jubily password was changed');
    expect(changed.html).toContain('Jubily');
    expect(changed.html).not.toContain('Oneverse');
    expect(changed.text).not.toContain('Oneverse');
  });
});

describe('AuthEmailService SMTP delivery', () => {
  const originalEnv = process.env;
  let sendMail: jest.Mock;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FRONTEND_URL: 'https://joinjubily.com',
      APP_WEB_URL: 'https://app.jubily.test',
      PUBLIC_API_BASE_URL: 'https://api.joinjubily.com',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'smtp-user',
      SMTP_PASSWORD: 'smtp-password',
      EMAIL_FROM: 'Jubily <noreply@joinjubily.com>',
      SUPPORT_EMAIL: 'info@joinjubily.com',
    };
    sendMail = jest.fn().mockResolvedValue({ messageId: 'message-1' });
    jest.mocked(nodemailer.createTransport).mockReset();
    jest
      .mocked(nodemailer.createTransport)
      .mockReturnValue({ sendMail } as never);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates an SMTP transport without logging credentials and sends verification email', async () => {
    const service = new AuthEmailService();

    await expect(
      service.sendVerificationEmail(
        { id: 'user-1', email: 'user@example.com', name: 'User' },
        'verify-token',
      ),
    ).resolves.toEqual({ sent: true, messageId: 'message-1' });

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'smtp-user', pass: 'smtp-password' },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'Jubily', address: 'noreply@joinjubily.com' },
        to: 'user@example.com',
        subject: 'Verify your Jubily email',
        text: expect.stringContaining(
          'https://joinjubily.com/verify-email?token=verify-token',
        ),
      }),
    );
    expect(sendMail.mock.calls[0][0].text).not.toContain(
      'https://api.joinjubily.com',
    );
  });

  it('does not fall back to localhost for hosted account email links', async () => {
    delete process.env.FRONTEND_URL;
    delete process.env.APP_WEB_URL;
    delete process.env.PUBLIC_APP_URL;
    process.env.NODE_ENV = 'production';
    const service = new AuthEmailService();

    expect(() =>
      service.sendVerificationEmail(
        { id: 'user-1', email: 'user@example.com' },
        'verify-token',
      ),
    ).toThrow('FRONTEND_URL is required for account email links');

    process.env.FRONTEND_URL = 'http://localhost:3000';
    expect(() =>
      service.sendPasswordResetEmail(
        { id: 'user-1', email: 'user@example.com' },
        'reset-token',
      ),
    ).toThrow('FRONTEND_URL must not use a local host');
  });

  it('debug logs only the generated email link domain, never the token', async () => {
    const service = new AuthEmailService();
    const debugSpy = jest
      .spyOn((service as any).logger, 'debug')
      .mockImplementation(jest.fn());

    await service.sendVerificationEmail(
      { id: 'user-1', email: 'user@example.com' },
      'secret-token',
    );

    expect(JSON.stringify(debugSpy.mock.calls)).toContain('joinjubily.com');
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('secret-token');
  });

  it('sends password reset and password changed emails', async () => {
    const service = new AuthEmailService();

    await service.sendPasswordResetEmail(
      { id: 'user-1', email: 'user@example.com' },
      'reset-token',
    );
    await service.sendPasswordChangedEmail({
      id: 'user-1',
      email: 'user@example.com',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Reset your Jubily password' }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Your Jubily password was changed' }),
    );
  });

  it('handles SMTP failures gracefully', async () => {
    sendMail.mockRejectedValue(new Error('smtp unavailable'));
    const service = new AuthEmailService();

    await expect(
      service.sendPasswordChangedEmail({
        id: 'user-1',
        email: 'user@example.com',
      }),
    ).resolves.toEqual({ sent: false, error: 'smtp unavailable' });
  });

  it('records failed delivery attempts in the email outbox', async () => {
    sendMail.mockRejectedValue(new Error('smtp unavailable'));
    const prisma = {
      emailOutbox: {
        create: jest.fn().mockResolvedValue({ id: 'email-1' }),
        update: jest.fn().mockResolvedValue({ id: 'email-1' }),
      },
    };
    const service = new AuthEmailService(prisma as never);

    await service.sendPasswordResetEmail(
      { id: 'user-1', email: 'user@example.com' },
      'reset-token',
    );

    expect(prisma.emailOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        to: 'user@example.com',
        type: 'password_reset',
        status: 'PENDING',
      }),
    });
    expect(prisma.emailOutbox.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: 'smtp unavailable',
      }),
    });
  });

  it('selects the log provider and records successful outbox delivery without sending SMTP', async () => {
    process.env.EMAIL_PROVIDER = 'log';
    delete process.env.SMTP_HOST;
    const prisma = {
      emailOutbox: {
        create: jest.fn().mockResolvedValue({ id: 'email-1' }),
        update: jest.fn().mockResolvedValue({ id: 'email-1' }),
      },
    };
    const service = new AuthEmailService(prisma as never);
    const logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(jest.fn());

    await expect(
      service.sendVerificationEmail(
        { id: 'user-1', email: 'user@example.com' },
        'verify-token',
      ),
    ).resolves.toEqual(expect.objectContaining({ sent: true }));

    expect(service.getProvider()).toBe('log');
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(prisma.emailOutbox.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: expect.objectContaining({
        status: 'SENT',
        sentAt: expect.any(Date),
      }),
    });
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('verify-token');
  });

  it('sends with Resend and never logs the API key', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_secret_123';
    process.env.EMAIL_FROM = 'Jubily <noreply@joinjubily.com>';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ id: 'resend-1' }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as never;
    const service = new AuthEmailService();
    const logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(jest.fn());

    await expect(
      service.sendPasswordResetEmail(
        { id: 'user-1', email: 'user@example.com' },
        'reset-token',
      ),
    ).resolves.toEqual({ sent: true, messageId: 'resend-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_secret_123',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('re_secret_123');
    global.fetch = originalFetch;
  });

  it('records Resend delivery failures in the outbox without leaking secrets', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_secret_456';
    process.env.EMAIL_FROM = 'Jubily <noreply@joinjubily.com>';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({ message: 'invalid api key' }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as never;
    const prisma = {
      emailOutbox: {
        create: jest.fn().mockResolvedValue({ id: 'email-1' }),
        update: jest.fn().mockResolvedValue({ id: 'email-1' }),
      },
    };
    const service = new AuthEmailService(prisma as never);
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(jest.fn());

    await expect(
      service.sendPasswordChangedEmail({
        id: 'user-1',
        email: 'user@example.com',
      }),
    ).resolves.toEqual({ sent: false, error: 'invalid api key' });

    expect(prisma.emailOutbox.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: 'invalid api key',
        nextAttemptAt: expect.any(Date),
      }),
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('re_secret_456');
    global.fetch = originalFetch;
  });

  it('retries failed outbox emails and marks permanent failure after the cap', async () => {
    process.env.EMAIL_PROVIDER = 'smtp';
    sendMail
      .mockResolvedValueOnce({ messageId: 'retry-1' })
      .mockRejectedValueOnce(new Error('smtp down'));
    const prisma = {
      emailOutbox: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new AuthEmailService(prisma as never);

    await expect(
      service.retryOutboxEmail({
        id: 'email-1',
        userId: 'user-1',
        to: 'user@example.com',
        type: 'verification',
        subject: 'Subject',
        text: 'Text',
        html: '<p>Text</p>',
        attempts: 1,
      }),
    ).resolves.toEqual({ sent: true, messageId: 'retry-1' });

    await expect(
      service.retryOutboxEmail(
        {
          id: 'email-2',
          userId: 'user-1',
          to: 'user@example.com',
          type: 'verification',
          subject: 'Subject',
          text: 'Text',
          html: '<p>Text</p>',
          attempts: 4,
        },
        5,
      ),
    ).resolves.toEqual({ sent: false, error: 'smtp down', permanent: true });

    expect(prisma.emailOutbox.update).toHaveBeenCalledWith({
      where: { id: 'email-2' },
      data: expect.objectContaining({
        status: 'FAILED_PERMANENT',
        nextAttemptAt: null,
      }),
    });
  });
});
