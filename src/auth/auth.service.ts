/* eslint-disable prettier/prettier */
import { Injectable, UnauthorizedException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async onModuleInit() {
    await this.seedAdminFromEnv();
  }

  async seedAdminFromEnv() {
    const email = process.env.ADMIN_SEED_EMAIL;
    const password = process.env.ADMIN_SEED_PASSWORD;

    if (!email || !password) return;

    const exists = await this.prisma.adminUser.findUnique({ where: { email } });
    if (exists) return;

    const passwordHash = await bcrypt.hash(password, 12);

    await this.prisma.adminUser.create({
      data: { email, passwordHash, role: 'ADMIN', active: true },
    });
  }

  async login(email: string, password: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !admin.active) throw new UnauthorizedException('Invalid credentials');

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
