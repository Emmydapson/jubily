import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import {
  passwordChangedEmailTemplate,
  passwordResetEmailTemplate,
  verificationEmailTemplate,
} from './email-templates';
import { PrismaService } from '../prisma/prisma.service';

type AccountEmailUser = {
  id: string;
  email: string;
  name?: string | null;
};

type AccountEmailType = 'verification' | 'password_reset' | 'password_changed';

type AccountEmailPayload = {
  to: string;
  userId: string;
  type: AccountEmailType;
  subject: string;
  text: string;
  html: string;
};

export type EmailProvider = 'log' | 'smtp' | 'resend';

type EmailDeliveryResult = {
  sent: boolean;
  messageId?: string | null;
  error?: string;
};

type OutboxEmail = {
  id: string;
  userId?: string | null;
  to: string;
  type: string;
  subject: string;
  text: string;
  html: string;
  attempts: number;
};

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly prisma?: PrismaService) {}

  private appBaseUrl() {
    return String(
      process.env.FRONTEND_URL ||
        process.env.APP_WEB_URL ||
        process.env.PUBLIC_APP_URL ||
        'http://localhost:3000',
    ).replace(/\/+$/, '');
  }

  private verificationUrl(token: string) {
    return `${this.appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  }

  private resetUrl(token: string) {
    return `${this.appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  }

  private fromAddress() {
    const fromEmail = String(process.env.FROM_EMAIL || '').trim();
    const fromName = String(process.env.FROM_NAME || 'Jubily').trim();
    return fromEmail ? { name: fromName, address: fromEmail } : undefined;
  }

  private resendFromAddress() {
    const from = this.fromAddress();
    if (!from?.address) throw new BadRequestException('FROM_EMAIL is required for email delivery');
    return from.name ? `${from.name} <${from.address}>` : from.address;
  }

  getProvider(): EmailProvider {
    const configured = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
    const provider = configured || (process.env.SMTP_HOST ? 'smtp' : 'log');
    if (provider === 'log' || provider === 'smtp' || provider === 'resend') return provider;
    throw new BadRequestException('EMAIL_PROVIDER must be log, smtp, or resend');
  }

  private createTransporter() {
    return nodemailer.createTransport({
      host: String(process.env.SMTP_HOST || '').trim(),
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: {
        user: String(process.env.SMTP_USER || ''),
        pass: String(process.env.SMTP_PASSWORD || ''),
      },
    });
  }

  getTransporter() {
    if (!this.transporter) this.transporter = this.createTransporter();
    return this.transporter;
  }

  private safeLog(input: Pick<AccountEmailPayload, 'to' | 'userId' | 'type' | 'subject'>, message: string, extra: Record<string, unknown> = {}) {
    this.logger.log({
      message,
      provider: this.getProvider(),
      userId: input.userId,
      to: input.to,
      type: input.type,
      subject: input.subject,
      ...extra,
    });
  }

  private async deliver(input: AccountEmailPayload): Promise<EmailDeliveryResult> {
    const provider = this.getProvider();
    if (provider === 'log') {
      this.safeLog(input, 'Account email logged instead of sent');
      return { sent: true, messageId: `log-${Date.now()}` };
    }

    if (provider === 'smtp') {
      const result = await this.getTransporter().sendMail({
        from: this.fromAddress(),
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return { sent: true, messageId: result.messageId ?? null };
    }

    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) throw new BadRequestException('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.resendFromAddress(),
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof body?.message === 'string' ? body.message : `Resend delivery failed (${response.status})`;
      throw new Error(message);
    }
    return { sent: true, messageId: typeof body?.id === 'string' ? body.id : null };
  }

  private nextAttemptAt(attempts: number) {
    const delayMinutes = Math.min(60, 5 * 2 ** Math.max(0, attempts - 1));
    return new Date(Date.now() + delayMinutes * 60_000);
  }

  private async sendEmail(input: AccountEmailPayload) {
    const outbox = this.prisma
      ? await this.prisma.emailOutbox.create({
          data: {
            userId: input.userId,
            to: input.to,
            type: input.type,
            subject: input.subject,
            text: input.text,
            html: input.html,
            status: 'PENDING',
            nextAttemptAt: new Date(),
          },
        })
      : null;

    try {
      const result = await this.deliver(input);

      this.safeLog(input, 'Account email sent', { messageId: result.messageId ?? null });
      if (outbox && this.prisma) {
        await this.prisma.emailOutbox.update({
          where: { id: outbox.id },
          data: {
            status: 'SENT',
            attempts: { increment: 1 },
            providerMessageId: result.messageId ?? null,
            sentAt: new Date(),
            lastError: null,
            nextAttemptAt: null,
          },
        });
      }
      return { sent: true, messageId: result.messageId ?? null };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Email delivery failed';
      this.logger.warn({
        message: 'Account email delivery failed',
        provider: this.getProvider(),
        userId: input.userId,
        to: input.to,
        type: input.type,
        error: message,
      });
      if (outbox && this.prisma) {
        await this.prisma.emailOutbox.update({
          where: { id: outbox.id },
          data: {
            status: 'FAILED',
            attempts: { increment: 1 },
            lastError: message.slice(0, 1000),
            nextAttemptAt: this.nextAttemptAt(1),
          },
        });
      }
      return { sent: false, error: message };
    }
  }

  async retryOutboxEmail(email: OutboxEmail, maxAttempts = 5) {
    const input: AccountEmailPayload = {
      to: email.to,
      userId: email.userId ?? '',
      type: email.type as AccountEmailType,
      subject: email.subject,
      text: email.text,
      html: email.html,
    };
    try {
      const result = await this.deliver(input);
      if (this.prisma) {
        await this.prisma.emailOutbox.update({
          where: { id: email.id },
          data: {
            status: 'SENT',
            attempts: { increment: 1 },
            providerMessageId: result.messageId ?? null,
            sentAt: new Date(),
            lastError: null,
            nextAttemptAt: null,
          },
        });
      }
      this.safeLog(input, 'Outbox email retry sent', { emailId: email.id, messageId: result.messageId ?? null });
      return { sent: true, messageId: result.messageId ?? null };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Email delivery failed';
      const nextAttempts = email.attempts + 1;
      const permanent = nextAttempts >= maxAttempts;
      if (this.prisma) {
        await this.prisma.emailOutbox.update({
          where: { id: email.id },
          data: {
            status: permanent ? 'FAILED_PERMANENT' : 'FAILED',
            attempts: { increment: 1 },
            lastError: message.slice(0, 1000),
            nextAttemptAt: permanent ? null : this.nextAttemptAt(nextAttempts),
          },
        });
      }
      this.logger.warn({
        message: permanent ? 'Outbox email retry permanently failed' : 'Outbox email retry failed',
        provider: this.getProvider(),
        emailId: email.id,
        userId: input.userId,
        to: input.to,
        type: input.type,
        error: message,
      });
      return { sent: false, error: message, permanent };
    }
  }

  sendVerificationEmail(user: AccountEmailUser, token: string) {
    const template = verificationEmailTemplate({ name: user.name, url: this.verificationUrl(token) });
    return this.sendEmail({
      to: user.email,
      userId: user.id,
      type: 'verification',
      ...template,
    });
  }

  sendPasswordResetEmail(user: AccountEmailUser, token: string) {
    const template = passwordResetEmailTemplate({ name: user.name, url: this.resetUrl(token) });
    return this.sendEmail({
      to: user.email,
      userId: user.id,
      type: 'password_reset',
      ...template,
    });
  }

  sendPasswordChangedEmail(user: AccountEmailUser) {
    const template = passwordChangedEmailTemplate(user.name);
    return this.sendEmail({
      to: user.email,
      userId: user.id,
      type: 'password_changed',
      ...template,
    });
  }
}
