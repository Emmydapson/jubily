/* eslint-disable prettier/prettier */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthEmailService } from './auth-email.service';
import { PromoCodesService } from '../promos/promo-codes.service';

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
  acceptedTermsAt?: Date | null;
  acceptedPrivacyPolicyAt?: Date | null;
};

type FailedLoginState = {
  count: number;
  lockedUntil?: number;
};

const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60_000;
const LEGAL_CONSENT_REQUIRED_MESSAGE = 'You must accept the Terms of Service and Privacy Policy to create an account.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly failedLogins = new Map<string, FailedLoginState>();

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private emails: AuthEmailService,
    private promos?: PromoCodesService,
  ) {}

  private normalizeEmail(email: string) {
    return String(email || '').trim().toLowerCase();
  }

  private normalizeSlug(value: string) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private onboardingState(emailVerified: boolean, workspaceCount: number) {
    const needsWorkspace = workspaceCount === 0;
    return {
      emailVerified,
      hasWorkspace: !needsWorkspace,
      needsWorkspace,
      required: needsWorkspace,
      reason: needsWorkspace ? 'NO_WORKSPACE' : null,
    };
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

  private legalVersion(name: 'TERMS_VERSION' | 'PRIVACY_POLICY_VERSION') {
    return String(process.env[name] || '').trim() || null;
  }

  private assertSignupConsent(input?: { acceptedTerms?: boolean; acceptedPrivacyPolicy?: boolean }) {
    if (input?.acceptedTerms !== true || input?.acceptedPrivacyPolicy !== true) {
      throw new BadRequestException(LEGAL_CONSENT_REQUIRED_MESSAGE);
    }
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

  private defaultWorkspaceName(name?: string | null) {
    const firstName = String(name || '').trim().split(/\s+/).filter(Boolean)[0];
    return firstName ? `${firstName}'s Workspace` : 'My Workspace';
  }

  private async createDefaultWorkspaceForUser(user: SaasUser) {
    const name = this.defaultWorkspaceName(user.name);
    const slugBase = this.normalizeSlug(name);
    const slugSuffix = this.normalizeSlug(user.id).slice(0, 8);
    const slug = [slugBase, slugSuffix].filter(Boolean).join('-') || null;

    const workspace = await this.prisma.workspace.create({
      data: {
        name,
        slug,
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
      select: { id: true, slug: true },
    });

    await this.audit.record({
      action: 'WORKSPACE_CREATED',
      workspaceId: workspace.id,
      userId: user.id,
      targetType: 'Workspace',
      targetId: workspace.id,
      metadata: { slug: workspace.slug, default: true },
    });
    this.logger.log({ message: 'Default workspace provisioned', userId: user.id, workspaceId: workspace.id });
    return workspace;
  }

  private async ensureWorkspacesForVerifiedUser(user: SaasUser) {
    const existing = await this.userWorkspaces(user.id);
    if (existing.length > 0 || !user.emailVerified) return existing;

    try {
      await this.createDefaultWorkspaceForUser(user);
    } catch (error: any) {
      if (error?.code !== 'P2002') {
        this.logger.error({
          message: 'Default workspace provisioning failed',
          userId: user.id,
          error: error?.message || String(error),
        });
        throw new InternalServerErrorException('Workspace provisioning failed. Please try again.');
      }
    }

    const recovered = await this.userWorkspaces(user.id);
    if (recovered.length === 0) {
      this.logger.error({ message: 'Default workspace recovery returned no workspace', userId: user.id });
      throw new InternalServerErrorException('Workspace provisioning failed. Please try again.');
    }
    return recovered;
  }

  private async userWorkspaces(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return memberships.map((membership) => ({
      ...membership.workspace,
      role: membership.role,
    }));
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
    const workspaces = await this.ensureWorkspacesForVerifiedUser(user);
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
        acceptedTermsAt: user.acceptedTermsAt ?? null,
        acceptedPrivacyPolicyAt: user.acceptedPrivacyPolicyAt ?? null,
      },
      emailVerified: Boolean(user.emailVerified),
      workspaces,
      workspace: workspaces[0] ?? null,
      onboarding: this.onboardingState(Boolean(user.emailVerified), workspaces.length),
    };
  }

  private verificationRequiredResponse(user: SaasUser, verificationEmailSent: boolean) {
    return {
      success: false,
      code: 'EMAIL_NOT_VERIFIED',
      message: verificationEmailSent
        ? 'Email verification required. Verification email sent.'
        : 'Email verification required. Please check your inbox or request a new verification email.',
      requiresEmailVerification: true,
      emailVerified: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        emailVerified: false,
        emailVerifiedAt: user.emailVerifiedAt ?? null,
        acceptedTermsAt: user.acceptedTermsAt ?? null,
        acceptedPrivacyPolicyAt: user.acceptedPrivacyPolicyAt ?? null,
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

  private async createVerificationTokenIfAllowed(user: SaasUser) {
    const latestToken = await this.prisma.emailVerificationToken.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (
      latestToken?.createdAt &&
      latestToken.createdAt.getTime() > Date.now() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      return false;
    }
    await this.createVerificationToken(user);
    return true;
  }

  async signup(
    email: string,
    password: string,
    name?: string,
    meta?: ClientMeta,
    promoCode?: string,
    consent?: { acceptedTerms?: boolean; acceptedPrivacyPolicy?: boolean },
  ) {
    this.assertSignupConsent(consent);
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) throw new UnauthorizedException('Invalid email');

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email is already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const consentedAt = new Date();
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: String(name || '').trim() || null,
        emailVerified: false,
        acceptedTermsAt: consentedAt,
        acceptedPrivacyPolicyAt: consentedAt,
        termsVersion: this.legalVersion('TERMS_VERSION'),
        privacyPolicyVersion: this.legalVersion('PRIVACY_POLICY_VERSION'),
      },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        emailVerifiedAt: true,
        acceptedTermsAt: true,
        acceptedPrivacyPolicyAt: true,
      },
    });

    await this.audit.record({
      action: 'SIGNUP',
      userId: user.id,
      targetType: 'User',
      targetId: user.id,
    });
    const workspace = await this.createDefaultWorkspaceForUser(user);
    if (promoCode && this.promos) {
      await this.promos.recordSignup(promoCode, user.id, workspace.id);
    }
    await this.createVerificationToken(user);
    return this.verificationRequiredResponse(user, true);
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
    this.logger.log({ message: 'Admin login success', adminId: admin.id });
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
        acceptedTermsAt: true,
        acceptedPrivacyPolicyAt: true,
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

    if (!user.emailVerified) {
      this.clearLoginFailures(normalizedEmail);
      const verificationEmailSent = await this.createVerificationTokenIfAllowed(user);
      this.logger.log({
        message: 'Customer login blocked pending email verification',
        userId: user.id,
        verificationEmailSent,
      });
      return this.verificationRequiredResponse(user, verificationEmailSent);
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
    this.logger.log({ message: 'Customer login success', userId: user.id });
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

    const sent = await this.createVerificationTokenIfAllowed(user);
    if (!sent) {
      throw new HttpException(
        {
          success: false,
          message: 'Please wait 60 seconds before requesting another verification email.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

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
            acceptedTermsAt: true,
            acceptedPrivacyPolicyAt: true,
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
    const workspaces = await this.ensureWorkspacesForVerifiedUser(session.user);

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? null,
        emailVerified: Boolean(session.user.emailVerified),
        emailVerifiedAt: session.user.emailVerifiedAt ?? null,
        acceptedTermsAt: session.user.acceptedTermsAt ?? null,
        acceptedPrivacyPolicyAt: session.user.acceptedPrivacyPolicyAt ?? null,
      },
      emailVerified: Boolean(session.user.emailVerified),
      workspaces,
      workspace: workspaces[0] ?? null,
      onboarding: this.onboardingState(Boolean(session.user.emailVerified), workspaces.length),
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
        acceptedTermsAt: true,
        acceptedPrivacyPolicyAt: true,
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
    if (!user) return null;
    const existingWorkspaces = user.memberships.map((membership) => ({
      ...membership.workspace,
      role: membership.role,
    }));
    const workspaces =
      existingWorkspaces.length > 0 || !user.emailVerified
        ? existingWorkspaces
        : await this.ensureWorkspacesForVerifiedUser(user);
    this.logger.debug({ message: 'Current user fetched', userId: identity.userId, workspaceCount: workspaces.length });
    return {
      kind: 'user',
      user,
      emailVerified: Boolean(user.emailVerified),
      workspaces,
      workspace: workspaces[0] ?? null,
      onboarding: this.onboardingState(Boolean(user.emailVerified), workspaces.length),
    };
  }
}
