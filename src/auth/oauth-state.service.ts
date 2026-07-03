import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export type OAuthStatePurpose =
  | 'admin_youtube'
  | 'workspace_youtube'
  | 'workspace_tiktok'
  | 'workspace_facebook';

@Injectable()
export class OAuthStateService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(state: string) {
    return createHash('sha256').update(state).digest('hex');
  }

  private randomState() {
    return randomBytes(32).toString('base64url');
  }

  async create(input: {
    purpose: OAuthStatePurpose;
    ttlMs: number;
    workspaceId?: string | null;
    userId?: string | null;
    adminId?: string | null;
    adminEmail?: string | null;
  }) {
    const state = this.randomState();
    await this.prisma.oAuthState.create({
      data: {
        stateHash: this.hash(state),
        purpose: input.purpose,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId ?? null,
        adminId: input.adminId ?? null,
        adminEmail: input.adminEmail ?? null,
        expiresAt: new Date(Date.now() + input.ttlMs),
      },
    });
    return state;
  }

  async consume(purpose: OAuthStatePurpose, state?: string | null) {
    if (!state) return null;
    const stateHash = this.hash(state);
    const now = new Date();
    const record = await this.prisma.oAuthState.findUnique({
      where: { stateHash },
    });
    if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt <= now) {
      return null;
    }

    const consumed = await this.prisma.oAuthState.updateMany({
      where: {
        id: record.id,
        purpose,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    return consumed.count === 1 ? record : null;
  }
}
