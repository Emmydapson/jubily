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
    workspace: { create: jest.Mock };
    workspaceMember: { findMany: jest.Mock };
    emailVerificationToken: { create: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
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
      workspace: {
        create: jest.fn(),
      },
      workspaceMember: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      emailVerificationToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
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
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        role: 'OWNER',
        workspace: { id: 'workspace-1', name: 'User Workspace', slug: 'user-workspace' },
      },
    ]);
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);

    await expect(service.login('user@example.com', 'secret')).resolves.toEqual({
      accessToken: 'signed.jwt.token',
      refreshToken: expect.any(String),
      emailVerified: true,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        emailVerified: true,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      workspaces: [{ id: 'workspace-1', name: 'User Workspace', slug: 'user-workspace', role: 'OWNER' }],
      workspace: { id: 'workspace-1', name: 'User Workspace', slug: 'user-workspace', role: 'OWNER' },
      onboarding: {
        emailVerified: true,
        hasWorkspace: true,
        needsWorkspace: false,
        required: false,
        reason: null,
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

  it('blocks unverified SaaS login without issuing access tokens and resends when allowed', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      passwordHash: 'hash',
      active: true,
      emailVerified: false,
      emailVerifiedAt: null,
    });
    prisma.emailVerificationToken.findFirst.mockResolvedValue(null);
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);

    await expect(service.login('user@example.com', 'secret')).resolves.toEqual({
      success: false,
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Email verification required. Verification email sent.',
      requiresEmailVerification: true,
      emailVerified: false,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        emailVerified: false,
        emailVerifiedAt: null,
      },
    });

    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(prisma.userSession.create).not.toHaveBeenCalled();
    expect(emails.sendVerificationEmail).toHaveBeenCalled();
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

  it('signs up SaaS users, creates a default workspace, sends verification email, and returns no tokens', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    jest.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never);
    prisma.user.create.mockResolvedValue({
      id: 'user-123456789',
      email: 'user@example.com',
      name: 'User',
      emailVerified: false,
      emailVerifiedAt: null,
    });
    prisma.workspace.create.mockResolvedValue({
      id: 'workspace-1',
      slug: 'user-s-workspace-user-123',
    });

    await expect(service.signup('USER@example.com', 'password123', 'User')).resolves.toEqual({
      success: false,
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Email verification required. Verification email sent.',
      requiresEmailVerification: true,
      emailVerified: false,
      user: {
        id: 'user-123456789',
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
    expect(prisma.workspace.create).toHaveBeenCalledWith({
      data: {
        name: "User's Workspace",
        slug: 'user-s-workspace-user-123',
        ownerId: 'user-123456789',
        members: {
          create: {
            userId: 'user-123456789',
            role: 'OWNER',
          },
        },
      },
      select: { id: true, slug: true },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'WORKSPACE_CREATED',
      workspaceId: 'workspace-1',
      userId: 'user-123456789',
    }));
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-123456789',
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
    expect(emails.sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-123456789', email: 'user@example.com' }),
      expect.any(String),
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(prisma.userSession.create).not.toHaveBeenCalled();
  });

  it('verifies email tokens once and rejects expired verification tokens', async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 'verification-1',
      userId: 'user-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', emailVerified: false },
    });

    await expect(service.verifyEmail('raw-token')).resolves.toEqual({
      success: true,
      message: 'Email verified successfully.',
    });
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
      user: { id: 'user-1', emailVerified: false },
    });
    await expect(service.verifyEmail('expired-token')).rejects.toMatchObject({
      response: { success: false, message: 'Verification link has expired.' },
      status: 400,
    });
  });

  it('returns specific responses for already verified and invalid verification tokens', async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 'verification-1',
      userId: 'user-1',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', emailVerified: true },
    });

    await expect(service.verifyEmail('used-token')).resolves.toEqual({
      success: true,
      message: 'Email already verified.',
    });

    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce(null);
    await expect(service.verifyEmail('bad-token')).rejects.toMatchObject({
      response: { success: false, message: 'Invalid verification token.' },
      status: 400,
    });
  });

  it('resends verification for unverified users', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      emailVerified: false,
      emailVerifiedAt: null,
    });
    prisma.emailVerificationToken.findFirst.mockResolvedValue(null);

    await expect(service.resendVerification('USER@example.com')).resolves.toEqual({
      success: true,
      message: 'Verification email sent.',
    });

    expect(prisma.emailVerificationToken.create).toHaveBeenCalled();
    expect(emails.sendVerificationEmail).toHaveBeenCalled();
  });

  it('does not resend verification for verified users and rate limits rapid resend requests', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });

    await expect(service.resendVerification('user@example.com')).resolves.toEqual({
      success: true,
      message: 'Email already verified.',
    });
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();

    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'user-2',
      email: 'new@example.com',
      name: 'New',
      emailVerified: false,
      emailVerifiedAt: null,
    });
    prisma.emailVerificationToken.findFirst.mockResolvedValueOnce({ createdAt: new Date(Date.now() - 30_000) });

    await expect(service.resendVerification('new@example.com')).rejects.toMatchObject({
      response: {
        success: false,
        message: 'Please wait 60 seconds before requesting another verification email.',
      },
      status: 429,
    });
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
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        role: 'OWNER',
        workspace: { id: 'workspace-1', name: 'User Workspace', slug: 'user-workspace' },
      },
    ]);

    await expect(service.refresh('refresh-token')).resolves.toEqual({
      accessToken: 'signed.jwt.token',
      refreshToken: expect.any(String),
      emailVerified: true,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        emailVerified: true,
        emailVerifiedAt: null,
      },
      workspaces: [{ id: 'workspace-1', name: 'User Workspace', slug: 'user-workspace', role: 'OWNER' }],
      workspace: { id: 'workspace-1', name: 'User Workspace', slug: 'user-workspace', role: 'OWNER' },
      onboarding: {
        emailVerified: true,
        hasWorkspace: true,
        needsWorkspace: false,
        required: false,
        reason: null,
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

  it('returns current user with onboarding and workspace state', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      active: true,
      emailVerified: true,
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordChangedAt: null,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      memberships: [
        {
          role: 'OWNER',
          workspace: { id: 'workspace-1', name: 'User Workspace', slug: 'user-workspace' },
        },
      ],
    });

    await expect(service.me({ userId: 'user-1' })).resolves.toEqual({
      kind: 'user',
      user: expect.objectContaining({ id: 'user-1', emailVerified: true }),
      emailVerified: true,
      workspaces: [{ id: 'workspace-1', name: 'User Workspace', slug: 'user-workspace', role: 'OWNER' }],
      workspace: { id: 'workspace-1', name: 'User Workspace', slug: 'user-workspace', role: 'OWNER' },
      onboarding: {
        emailVerified: true,
        hasWorkspace: true,
        needsWorkspace: false,
        required: false,
        reason: null,
      },
    });
  });

  it('returns explicit onboarding requirement for unverified users with zero workspaces', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      active: true,
      emailVerified: false,
      emailVerifiedAt: null,
      passwordChangedAt: null,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      memberships: [],
    });

    await expect(service.me({ userId: 'user-1' })).resolves.toMatchObject({
      kind: 'user',
      workspaces: [],
      workspace: null,
      onboarding: {
        emailVerified: false,
        hasWorkspace: false,
        needsWorkspace: true,
        required: true,
        reason: 'NO_WORKSPACE',
      },
    });
  });

  it('returns a clear error if verified zero-workspace recovery cannot produce a workspace', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      active: true,
      emailVerified: true,
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordChangedAt: null,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      memberships: [],
    });
    prisma.workspace.create.mockResolvedValue({ id: 'workspace-1', slug: 'user-s-workspace-user-1' });
    prisma.workspaceMember.findMany.mockResolvedValue([]);

    await expect(service.me({ userId: 'user-1' })).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'Workspace provisioning failed. Please try again.',
      }),
      status: 500,
    });
  });

  it('recovers a default workspace for a legacy verified user during login', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'legacy-user-1',
      email: 'legacy@example.com',
      name: 'Legacy User',
      passwordHash: 'hash',
      active: true,
      emailVerified: true,
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    prisma.workspaceMember.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          role: 'OWNER',
          workspace: { id: 'workspace-1', name: "Legacy's Workspace", slug: 'legacy-s-workspace-legacy-u' },
        },
      ]);
    prisma.workspace.create.mockResolvedValue({ id: 'workspace-1', slug: 'legacy-s-workspace-legacy-u' });
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);

    await expect(service.login('legacy@example.com', 'secret')).resolves.toMatchObject({
      workspaces: [{ id: 'workspace-1', name: "Legacy's Workspace", slug: 'legacy-s-workspace-legacy-u', role: 'OWNER' }],
      workspace: { id: 'workspace-1', name: "Legacy's Workspace", slug: 'legacy-s-workspace-legacy-u', role: 'OWNER' },
      onboarding: {
        hasWorkspace: true,
        needsWorkspace: false,
        required: false,
        reason: null,
      },
    });

    expect(prisma.workspace.create).toHaveBeenCalledTimes(1);
    expect(prisma.workspace.create).toHaveBeenCalledWith({
      data: {
        name: "Legacy's Workspace",
        slug: 'legacy-s-workspace-legacy-u',
        ownerId: 'legacy-user-1',
        members: { create: { userId: 'legacy-user-1', role: 'OWNER' } },
      },
      select: { id: true, slug: true },
    });
  });

  it('recovers a default workspace for a legacy verified user during /auth/me', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'legacy-user-1',
      email: 'legacy@example.com',
      name: null,
      active: true,
      emailVerified: true,
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordChangedAt: null,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      memberships: [],
    });
    prisma.workspaceMember.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          role: 'OWNER',
          workspace: { id: 'workspace-1', name: 'My Workspace', slug: 'my-workspace-legacy-u' },
        },
      ]);
    prisma.workspace.create.mockResolvedValue({ id: 'workspace-1', slug: 'my-workspace-legacy-u' });

    await expect(service.me({ userId: 'legacy-user-1' })).resolves.toMatchObject({
      workspaces: [{ id: 'workspace-1', name: 'My Workspace', slug: 'my-workspace-legacy-u', role: 'OWNER' }],
      workspace: { id: 'workspace-1', name: 'My Workspace', slug: 'my-workspace-legacy-u', role: 'OWNER' },
      onboarding: {
        hasWorkspace: true,
        needsWorkspace: false,
        required: false,
        reason: null,
      },
    });

    expect(prisma.workspace.create).toHaveBeenCalledTimes(1);
    expect(prisma.workspace.create).toHaveBeenCalledWith({
      data: {
        name: 'My Workspace',
        slug: 'my-workspace-legacy-u',
        ownerId: 'legacy-user-1',
        members: { create: { userId: 'legacy-user-1', role: 'OWNER' } },
      },
      select: { id: true, slug: true },
    });
  });

  it('does not duplicate workspace on repeated verified login or /auth/me when membership exists', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      passwordHash: 'hash',
      active: true,
      emailVerified: true,
      emailVerifiedAt: null,
      memberships: [
        {
          role: 'OWNER',
          workspace: { id: 'workspace-1', name: 'Existing Workspace', slug: 'existing-workspace' },
        },
      ],
    });
    prisma.workspaceMember.findMany.mockResolvedValue([
      {
        role: 'OWNER',
        workspace: { id: 'workspace-1', name: 'Existing Workspace', slug: 'existing-workspace' },
      },
    ]);
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);

    await service.login('user@example.com', 'secret');
    await service.login('user@example.com', 'secret');
    await service.me({ userId: 'user-1' });
    await service.me({ userId: 'user-1' });

    expect(prisma.workspace.create).not.toHaveBeenCalled();
  });
});
