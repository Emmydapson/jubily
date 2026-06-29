/* eslint-disable prettier/prettier */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtSecret } from './jwt.config';

type JwtPayload = {
  sub?: string;
  kind?: 'admin' | 'user';
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    super({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    const subjectId = String(payload?.sub || '');
    if (!subjectId) throw new UnauthorizedException('Invalid token');

    if (payload.kind === 'user') {
      const user = await this.prisma.user.findUnique({
        where: { id: subjectId },
        select: { id: true, email: true, name: true, active: true, emailVerified: true, emailVerifiedAt: true },
      });

      if (!user || !user.active) {
        throw new UnauthorizedException('Invalid token');
      }

      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: 'USER',
        kind: 'user',
        emailVerified: user.emailVerified,
        emailVerifiedAt: user.emailVerifiedAt,
      };
    }

    if (payload.kind !== 'admin') {
      throw new UnauthorizedException('Invalid token');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: subjectId },
      select: { id: true, email: true, role: true, active: true },
    });

    if (!admin || !admin.active) throw new UnauthorizedException('Invalid token');

    return {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      kind: 'admin',
    };
  }
}
