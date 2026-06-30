/* eslint-disable prettier/prettier */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthEmailService } from './auth-email.service';

type ClientMeta = {
  ip?: string;
  userAgent?: string;
};

type SaasUser = {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean;
  emailVerifiedAt?: Date | null;
};

type FailedLoginState = {
  count: number;
  lockedUntil?: number;
};

const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60_000;

@Injectable()
export class AuthService {
  private readonly failedLogins = new Map<string, FailedLoginState>();

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private emails: AuthEmailService,
  ) {}

  private normalizeEmail(email: string) {
    return String(email || '').trim().toLowerCase();
  }

  private allowedAdminEmails() {
    return String(process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((x) => this.normalizeEmail(x))
      .filter(Boolean);
  }

  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private randomToken() {
    return randomBytes(32).toString('base64url');
  }

  private minutesFromNow(minutes: number) {
    return new Date(Date.now() + minutes * 60_000);
  }

  private daysFromNow(days: number) {
    return new Date(Date.now() + days * 24 * 60 * 60_000);
  }

  private verificationTtlMinutes() {
    return Number(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES || 24 * 60);
  }

  private resetTtlMinutes() {
    return Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 60);
  }

  private refreshTtlDays() {
    return Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
  }

  private loginBackoffMs(count: number) {
    if (count < 5) return 0;
    return Math.min(15 * 60_000, 2 ** Math.min(count - 5, 6) * 30_000);
  }

  private assertLoginAllowed(email: string) {
    const state = this.failedLogins.get(email);
    if (state?.lockedUntil && state.lockedUntil > Date.now()) {
      throw new HttpException('Too many failed login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async recordFailedLogin(email: string, userId?: string) {
    const previous = this.failedLogins.get(email) || { count: 0 };
    const nextCount = previous.count + 1;
    const backoffMs = this.loginBackoffMs(nextCount);
    this.failedLogins.set(email, {
      count: nextCount,
      lockedUntil: backoffMs ? Date.now() + backoffMs : undefined,
    });

    await this.audit.record({
      action: 'LOGIN_FAILED',
      userId,
      targetType: 'User',
      metadata: { email, failedAttempts: nextCount, backoffMs },
    });
  }

  private clearLoginFailures(email: string) {
    this.failedLogins.delete(email);
  }

  private async createSession(userId: string, meta?: ClientMeta) {
    const refreshToken = this.randomToken();
    await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash: this.tokenHash(refreshToken),
        userAgent: meta?.userAgent || null,
        ip: meta?.ip || null,
        expiresAt: this.daysFromNow(this.refreshTtlDays()),
      },
    });
    return refreshToken;
  }

  private async signSaasUser(user: SaasUser, meta?: ClientMeta) {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      kind: 'user',
      role: 'USER',
      emailVerified: Boolean(user.emailVerified),
    });
    const refreshToken = await this.createSession(user.id, meta);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        emailVerified: Boolean(user.emailVerified),
        emailVerifiedAt: user.emailVerifiedAt ?? null,
      },
    };
  }

  ensureAdminEmailAllowed(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const allowedEmails = this.allowedAdminEmails();

    if (!normalizedEmail || !allowedEmails.includes(normalizedEmail)) {
      throw new UnauthorizedException('Admin access denied');
    }

    return normalizedEmail;
  }

  async assertVerified(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    });
    if (!user?.emailVerified) throw new ForbiddenException('Email verification required');
  }

  private async createVerificationToken(user: SaasUser) {
    const token = this.randomToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokenHash(token),
        expiresAt: this.minutesFromNow(this.verificationTtlMinutes()),
      },
    });
    await this.emails.sendVerificationEmail(user, token);
    await this.audit.record({
      action: 'EMAIL_VERIFICATION_SENT',
      userId: user.id,
      targetType: 'User',
      targetId: user.id,
    });
    return token;
  }

  async signup(email: string, password: string, name?: string, meta?: ClientMeta) {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) throw new UnauthorizedException('Invalid email');

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email is already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: String(name || '').trim() || null,
        emailVerified: false,
      },
      select: { id: true, email: true, name: true, emailVerified: true, emailVerifiedAt: true },
    });

    await this.audit.record({
      action: 'SIGNUP',
      userId: user.id,
      targetType: 'User',
      targetId: user.id,
    });
    await this.createVerificationToken(user);
    return this.signSaasUser(user, meta);
  }

  async adminLogin(email: string, password: string, meta?: ClientMeta) {
    const normalizedEmail = this.normalizeEmail(email);
    const allowedEmails = this.allowedAdminEmails();

    if (!normalizedEmail) throw new UnauthorizedException('Invalid credentials');
    this.assertLoginAllowed(normalizedEmail);

    if (allowedEmails.length && !allowedEmails.includes(normalizedEmail)) {
      await this.recordFailedLogin(normalizedEmail);
      throw new UnauthorizedException('Invalid credentials');
    }

    const admin = await this.prisma.adminUser.findUnique({ where: { email: normalizedEmail } });
    if (!admin?.active) {
      await this.recordFailedLogin(normalizedEmail);
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      await this.recordFailedLogin(normalizedEmail);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.clearLoginFailures(normalizedEmail);
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await this.jwt.signAsync({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      kind: 'admin',
    });

    await this.audit.record({
      action: 'LOGIN',
      adminId: admin.id,
      targetType: 'AdminUser',
      targetId: admin.id,
    });
    return {
      accessToken: token,
      admin: { id: admin.id, email: admin.email, role: admin.role },
    };
  }

  async customerLogin(email: string, password: string, meta?: ClientMeta) {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) throw new UnauthorizedException('Invalid credentials');
    this.assertLoginAllowed(normalizedEmail);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        active: true,
        emailVerified: true,
        emailVerifiedAt: true,
      },
    });

    if (!user || !user.active) {
      await this.recordFailedLogin(normalizedEmail);
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await this.recordFailedLogin(normalizedEmail, user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.clearLoginFailures(normalizedEmail);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      action: 'LOGIN',
      userId: user.id,
      targetType: 'User',
      targetId: user.id,
    });
    return this.signSaasUser(user, meta);
  }

  async login(email: string, password: string, meta?: ClientMeta) {
    return this.customerLogin(email, password, meta);
  }

  async verifyEmail(token: string) {
    const tokenHash = this.tokenHash(token);
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, emailVerified: true } } },
    });
    if (!record) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid verification token.',
      });
    }
    if (record.user.emailVerified || record.usedAt) {
      return {
        success: true,
        message: 'Email already verified.',
      };
    }
    if (record.expiresAt <= new Date()) {
      throw new BadRequestException({
        success: false,
        message: 'Verification link has expired.',
      });
    }

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerified: true, emailVerifiedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      action: 'EMAIL_VERIFIED',
      userId: record.userId,
      targetType: 'User',
      targetId: record.userId,
    });
    return {
      success: true,
      message: 'Email verified successfully.',
    };
  }

  async resendVerification(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, name: true, emailVerified: true, emailVerifiedAt: true },
    });
    if (!user) {
      throw new BadRequestException({
        success: false,
        message: 'User not found.',
      });
    }
    if (user.emailVerified) {
      return {
        success: true,
        message: 'Email already verified.',
      };
    }

    const latestToken = await this.prisma.emailVerificationToken.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (
      latestToken?.createdAt &&
      latestToken.createdAt.getTime() > Date.now() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      throw new HttpException(
        {
          success: false,
          message: 'Please wait 60 seconds before requesting another verification email.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.createVerificationToken(user);
    return {
      success: true,
      message: 'Verification email sent.',
    };
  }

  async forgotPassword(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, name: true, active: true },
    });
    if (user?.active) {
      const token = this.randomToken();
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.tokenHash(token),
          expiresAt: this.minutesFromNow(this.resetTtlMinutes()),
        },
      });
      await this.emails.sendPasswordResetEmail(user, token);
      await this.audit.record({
        action: 'PASSWORD_RESET_REQUESTED',
        userId: user.id,
        targetType: 'User',
        targetId: user.id,
      });
    }
    return { ok: true };
  }

  async resetPassword(token: string, password: string) {
    const tokenHash = this.tokenHash(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: now },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    await this.emails.sendPasswordChangedEmail(record.user);
    await this.audit.record({
      action: 'PASSWORD_RESET_COMPLETED',
      userId: record.userId,
      targetType: 'User',
      targetId: record.userId,
    });
    await this.audit.record({
      action: 'PASSWORD_CHANGED',
      userId: record.userId,
      targetType: 'User',
      targetId: record.userId,
    });
    return { ok: true };
  }

  async refresh(refreshToken: string, meta?: ClientMeta) {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: this.tokenHash(refreshToken) },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            active: true,
            emailVerified: true,
            emailVerifiedAt: true,
          },
        },
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const nextRefreshToken = this.randomToken();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: now, rotatedAt: now },
      }),
      this.prisma.userSession.create({
        data: {
          userId: session.userId,
          refreshTokenHash: this.tokenHash(nextRefreshToken),
          userAgent: meta?.userAgent || session.userAgent || null,
          ip: meta?.ip || session.ip || null,
          expiresAt: this.daysFromNow(this.refreshTtlDays()),
        },
      }),
    ]);

    const accessToken = await this.jwt.signAsync({
      sub: session.user.id,
      email: session.user.email,
      kind: 'user',
      role: 'USER',
      emailVerified: Boolean(session.user.emailVerified),
    });
    await this.audit.record({
      action: 'REFRESH_TOKEN_ROTATED',
      userId: session.userId,
      targetType: 'UserSession',
      targetId: session.id,
    });

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? null,
        emailVerified: Boolean(session.user.emailVerified),
        emailVerifiedAt: session.user.emailVerifiedAt ?? null,
      },
    };
  }

  async logout(refreshToken: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: this.tokenHash(refreshToken) },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (session && !session.revokedAt) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        action: 'LOGOUT',
        userId: session.userId,
        targetType: 'UserSession',
        targetId: session.id,
      });
    }
    return { ok: true };
  }

  async logoutAll(userId: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'LOGOUT_ALL',
      userId,
      targetType: 'User',
      targetId: userId,
    });
    return { ok: true };
  }

  async me(identity: { adminId?: string; userId?: string }) {
    if (identity.adminId) {
      const admin = await this.prisma.adminUser.findUnique({
        where: { id: identity.adminId },
        select: {
          id: true,
          email: true,
          role: true,
          active: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
      return admin ? { kind: 'admin', admin } : null;
    }

    if (!identity.userId) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: identity.userId },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        emailVerified: true,
        emailVerifiedAt: true,
        passwordChangedAt: true,
        lastLoginAt: true,
        createdAt: true,
        memberships: {
          select: {
            role: true,
            workspace: { select: { id: true, name: true, slug: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return user ? { kind: 'user', user } : null;
  }
}
