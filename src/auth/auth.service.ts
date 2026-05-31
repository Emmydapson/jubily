/* eslint-disable prettier/prettier */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
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

  ensureAdminEmailAllowed(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const allowedEmails = this.allowedAdminEmails();

    if (!normalizedEmail || !allowedEmails.includes(normalizedEmail)) {
      throw new UnauthorizedException('Admin access denied');
    }

    return normalizedEmail;
  }

  async login(email: string, password: string) {
    const normalizedEmail = this.ensureAdminEmailAllowed(email);

    const admin = await this.prisma.adminUser.findUnique({ where: { email: normalizedEmail } });

    if (!admin || !admin.active) throw new UnauthorizedException('Invalid credentials');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await this.jwt.signAsync({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    });

    return {
      accessToken: token,
      admin: { id: admin.id, email: admin.email, role: admin.role },
    };
  }

  async me(adminId: string) {
    return this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }
}
