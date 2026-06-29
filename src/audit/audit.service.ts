/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeMetadata } from '../common/safe-metadata';

type AuditInput = {
  action: AuditAction;
  workspaceId?: string | null;
  userId?: string | null;
  adminId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput) {
    try {
      return await this.prisma.auditLog.create({
        data: {
          action: input.action,
          workspaceId: input.workspaceId ?? null,
          userId: input.userId ?? null,
          adminId: input.adminId ?? null,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          metadata: sanitizeMetadata(input.metadata) as Prisma.InputJsonValue,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(`Audit log persistence failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
