import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  __esModule: true,
  default: { compare: jest.fn(), hash: jest.fn() },
}));

describe('AuthService', () => {
  const originalEnv = process.env;
  let prisma: {
    $transaction: jest.Mock;
    adminUser: { findUnique: jest.Mock; update: jest.Mock };
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    emailVerificationToken: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    passwordResetToken: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    userSession: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  };
  let jwt: { signAsync: jest.Mock };
  let audit: { record: jest.Mock };
  let emails: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
    sendPasswordChangedEmail: jest.Mock;
  };
  let service: AuthService;

  beforeEach(() => {
    process.env = { ...originalEnv, ADMIN_EMAILS: 'admin@joinjubily.com, ops@joinjubily.com' };
    prisma = {
      $transaction: jest.fn().mockResolvedValue([]),
      adminUser: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      emailVerificationToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      passwordResetToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    audit = { record: jest.fn().mockResolvedValue(null) };
    emails = {
      sendVerificationEmail: jest.fn().mockResolvedValue({ queued: true }),
      sendPasswordResetEmail: jest.fn().mockResolvedValue({ queued: true }),
      sendPasswordChangedEmail: jest.fn().mockResolvedValue({ queued: true }),
    };
    service = new AuthService(prisma as never, jwt as never, audit as never, emails as never);
    jest.mocked(bcrypt.compare).mockReset();
    jest.mocked(bcrypt.hash).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('normalizes allowed admin email, updates last login, and signs the expected JWT payload', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@joinjubily.com',
      passwordHash: 'hash',
      role: 'ADMIN',
      active: true,
    });
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);

    await expect(service.adminLogin('  ADMIN@JoinJubily.com ', 'secret')).resolves.toEqual({
      accessToken: 'signed.jwt.token',
      admin: { id: 'admin-1', email: 'admin@joinjubily.com', role: 'ADMIN' },
    });

    expect(prisma.adminUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@joinjubily.com' },
    });
    expect(prisma.adminUser.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGIN',
      adminId: 'admin-1',
    }));
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'admin-1',
      email: 'admin@joinjubily.com',
      role: 'ADMIN',
      kind: 'admin',
    });
  });

  it('does not let the customer login path authenticate admin credentials', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login('admin@joinjubily.com', 'secret')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('logs in SaaS users and creates a refresh session', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      passwordHash: 'hash',
      active: true,
      emailVerified: true,
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);

    await expect(service.login('user@example.com', 'secret')).resolves.toEqual({
      accessToken: 'signed.jwt.token',
      refreshToken: expect.any(String),
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        emailVerified: true,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
    expect(prisma.userSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        refreshTokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'user@example.com',
      kind: 'user',
      role: 'USER',
      emailVerified: true,
    });
  });

  it('records failed login attempts and rejects unknown SaaS users', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login('attacker@example.com', 'secret')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGIN_FAILED',
      metadata: expect.objectContaining({ failedAttempts: 1 }),
    }));
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('signs up SaaS users, creates verification token, sends verification email, and returns tokens', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    jest.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      emailVerified: false,
      emailVerifiedAt: null,
    });

    await expect(service.signup('USER@example.com', 'password123', 'User')).resolves.toEqual({
      accessToken: 'signed.jwt.token',
      refreshToken: expect.any(String),
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        emailVerified: false,
        emailVerifiedAt: null,
      },
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'user@example.com',
        passwordHash: 'hashed-password',
        name: 'User',
        emailVerified: false,
      },
      select: { id: true, email: true, name: true, emailVerified: true, emailVerifiedAt: true },
    });
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
    expect(emails.sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', email: 'user@example.com' }),
      expect.any(String),
    );
  });

  it('verifies email tokens once and rejects expired verification tokens', async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 'verification-1',
      userId: 'user-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1' },
    });

    await expect(service.verifyEmail('raw-token')).resolves.toEqual({ verified: true });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      undefined,
      undefined,
    ]);
    expect(prisma.emailVerificationToken.update).toHaveBeenCalledWith({
      where: { id: 'verification-1' },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerified: true, emailVerifiedAt: expect.any(Date) },
    });

    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 'verification-2',
      userId: 'user-1',
      usedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      user: { id: 'user-1' },
    });
    await expect(service.verifyEmail('expired-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('resends verification for unverified users', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      emailVerified: false,
      emailVerifiedAt: null,
    });

    await expect(service.resendVerification('USER@example.com')).resolves.toEqual({ ok: true });

    expect(prisma.emailVerificationToken.create).toHaveBeenCalled();
    expect(emails.sendVerificationEmail).toHaveBeenCalled();
  });

  it('creates password reset tokens and completes one-time reset with session revocation', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      active: true,
    });

    await expect(service.forgotPassword('USER@example.com')).resolves.toEqual({ ok: true });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
    expect(emails.sendPasswordResetEmail).toHaveBeenCalled();

    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: 'user-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    });
    jest.mocked(bcrypt.hash).mockResolvedValue('new-hash' as never);

    await expect(service.resetPassword('reset-token', 'new-password')).resolves.toEqual({ ok: true });
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 'reset-1' },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(emails.sendPasswordChangedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
    );
  });

  it('rejects expired password reset tokens', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: 'user-1',
      usedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    });

    await expect(service.resetPassword('expired-reset', 'new-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rotates refresh tokens and rejects reuse of the old token', async () => {
    prisma.userSession.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      userId: 'user-1',
      userAgent: 'ua',
      ip: '127.0.0.1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        active: true,
        emailVerified: true,
        emailVerifiedAt: null,
      },
    });

    await expect(service.refresh('refresh-token')).resolves.toEqual({
      accessToken: 'signed.jwt.token',
      refreshToken: expect.any(String),
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        emailVerified: true,
        emailVerifiedAt: null,
      },
    });

    expect(prisma.userSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { revokedAt: expect.any(Date), rotatedAt: expect.any(Date) },
    });
    expect(prisma.userSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', refreshTokenHash: expect.any(String) }),
    });

    prisma.userSession.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      userId: 'user-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: { active: true },
    });
    await expect(service.refresh('refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
