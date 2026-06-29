import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { WORKSPACE_ROLES_KEY } from './workspace-roles.decorator';
import type { WorkspaceRequest } from './workspace.types';
import { AuditService } from '../audit/audit.service';

const ROLE_ORDER = { MEMBER: 1, ADMIN: 2, OWNER: 3 } as const;

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  private requestedWorkspaceId(req: WorkspaceRequest) {
    const header = req.headers['x-workspace-id'];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    const fromQuery = typeof req.query?.workspaceId === 'string' ? req.query.workspaceId : '';
    const fromParam = typeof req.params?.workspaceId === 'string' ? req.params.workspaceId : '';
    const fromBody =
      req.body && typeof req.body === 'object' && typeof req.body.workspaceId === 'string'
        ? req.body.workspaceId
        : '';
    const routeWorkspaceId = String(fromParam || '').trim();
    const headerWorkspaceId = String(fromHeader || '').trim();
    if (routeWorkspaceId) {
      if (headerWorkspaceId && headerWorkspaceId !== routeWorkspaceId) {
        throw new ForbiddenException('Workspace header does not match route workspace');
      }
      return routeWorkspaceId;
    }
    return String(headerWorkspaceId || fromQuery || fromBody || '').trim();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<WorkspaceRequest>();
    if (req.user?.kind !== 'user' || !req.user?.userId) {
      throw new ForbiddenException('Workspace user is required');
    }

    const workspaceId = this.requestedWorkspaceId(req);
    if (!workspaceId) throw new ForbiddenException('Workspace is required');
    if (req.user.emailVerified === false) {
      await this.audit.record({
        action: 'PERMISSION_DENIED',
        workspaceId,
        userId: req.user.userId,
        metadata: { reason: 'email_not_verified' },
      });
      throw new ForbiddenException('Email verification required');
    }

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: req.user.userId } },
      select: {
        role: true,
        workspace: { select: { suspended: true, suspensionReason: true } },
      },
    });
    if (!member) {
      await this.audit.record({
        action: 'PERMISSION_DENIED',
        workspaceId,
        userId: req.user.userId,
        metadata: { reason: 'not_member' },
      });
      throw new ForbiddenException('Workspace access denied');
    }
    if (member.workspace.suspended) {
      await this.audit.record({
        action: 'PERMISSION_DENIED',
        workspaceId,
        userId: req.user.userId,
        metadata: { reason: 'workspace_suspended' },
      });
      throw new ForbiddenException(member.workspace.suspensionReason || 'Workspace is suspended');
    }

    const allowed = this.reflector.getAllAndOverride<Array<'OWNER' | 'ADMIN' | 'MEMBER'>>(
      WORKSPACE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed?.length) {
      const required = Math.min(...allowed.map((role) => ROLE_ORDER[role]));
      if (ROLE_ORDER[member.role] < required) {
        await this.audit.record({
          action: 'PERMISSION_DENIED',
          workspaceId,
          userId: req.user.userId,
          metadata: { reason: 'insufficient_workspace_role', role: member.role, required: allowed },
        });
        throw new ForbiddenException('Insufficient workspace role');
      }
    }

    req.workspace = { id: workspaceId, role: member.role };
    return true;
  }
}
