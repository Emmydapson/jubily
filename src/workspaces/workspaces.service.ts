import { ConflictException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { YoutubeService } from '../common/youtube.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly youtube: YoutubeService,
    private readonly audit: AuditService,
  ) {}

  private normalizeSlug(value: string) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private defaultWorkspaceName(name?: string | null) {
    const firstName = String(name || '').trim().split(/\s+/).filter(Boolean)[0];
    return firstName ? `${firstName}'s Workspace` : 'My Workspace';
  }

  private async createDefaultWorkspaceForUser(user: { id: string; name?: string | null }) {
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
      include: { members: { where: { userId: user.id }, select: { role: true } } },
    });

    await this.audit.record({
      action: 'WORKSPACE_CREATED',
      workspaceId: workspace.id,
      userId: user.id,
      targetType: 'Workspace',
      targetId: workspace.id,
      metadata: { slug: workspace.slug, default: true, recovery: true },
    });
    this.logger.log({ message: 'Default workspace recovered', userId: user.id, workspaceId: workspace.id });
    return workspace;
  }

  async createWorkspace(userId: string, dto: { name: string; slug?: string }) {
    const name = String(dto.name || '').trim();
    const slug = this.normalizeSlug(dto.slug || name);
    if (!name) throw new ConflictException('Workspace name is required');

    let workspace;
    try {
      workspace = await this.prisma.workspace.create({
        data: {
          name,
          slug: slug || null,
          ownerId: userId,
          members: {
            create: {
              userId,
              role: 'OWNER',
            },
          },
        },
        include: { members: { where: { userId }, select: { role: true } } },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('Workspace slug is already in use');
      throw error;
    }
    await this.audit.record({
      action: 'WORKSPACE_CREATED',
      workspaceId: workspace.id,
      userId,
      targetType: 'Workspace',
      targetId: workspace.id,
      metadata: { slug: workspace.slug },
    });
    this.logger.log({ message: 'Workspace created', userId, workspaceId: workspace.id });
    return workspace;
  }

  async listMine(userId: string) {
    const memberships = await this.findMemberships(userId);

    let workspaces = memberships.map((membership) => ({
      ...membership.workspace,
      role: membership.role,
    }));

    if (workspaces.length === 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, emailVerified: true },
      });

      if (user?.emailVerified) {
        try {
          await this.createDefaultWorkspaceForUser(user);
        } catch (error: any) {
          if (error?.code !== 'P2002') {
            this.logger.error({
              message: 'Default workspace recovery failed',
              userId,
              error: error?.message || String(error),
            });
            throw new InternalServerErrorException('Workspace provisioning failed. Please try again.');
          }
        }

        const recoveredMemberships = await this.findMemberships(userId);
        workspaces = recoveredMemberships.map((membership) => ({
          ...membership.workspace,
          role: membership.role,
        }));
        if (workspaces.length === 0) {
          this.logger.error({ message: 'Workspace recovery returned no workspace', userId });
          throw new InternalServerErrorException('Workspace provisioning failed. Please try again.');
        }
      }
    }

    this.logger.debug({ message: 'Workspace list fetched', userId, workspaceCount: workspaces.length });
    return workspaces;
  }

  private findMemberships(userId: string) {
    return this.prisma.workspaceMember.findMany({
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
  }

  async requireMembership(workspaceId: string, userId: string, roles?: Array<'OWNER' | 'ADMIN' | 'MEMBER'>) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true, workspace: { select: { id: true, name: true, slug: true } } },
    });
    if (!member) {
      await this.audit.record({ action: 'PERMISSION_DENIED', workspaceId, userId, metadata: { reason: 'not_member' } });
      throw new ForbiddenException('Workspace access denied');
    }

    if (roles?.length && !roles.includes(member.role)) {
      await this.audit.record({ action: 'PERMISSION_DENIED', workspaceId, userId, metadata: { reason: 'insufficient_workspace_role', role: member.role, required: roles } });
      throw new ForbiddenException('Insufficient workspace role');
    }

    return member;
  }

  async dashboardSummary(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, slug: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const [offers, topics, scripts, videoJobs, published, youtube] = await Promise.all([
      this.prisma.offer.count({ where: { workspaceId } }),
      this.prisma.topic.count({ where: { workspaceId } }),
      this.prisma.script.count({ where: { workspaceId } }),
      this.prisma.videoJob.count({ where: { workspaceId } }),
      this.prisma.videoJob.count({ where: { workspaceId, published: true } }),
      this.youtube.getWorkspaceChannelDiagnostics(workspaceId),
    ]);

    return {
      workspace,
      counts: { offers, topics, scripts, videoJobs, published },
      youtube,
    };
  }

  getYoutubeStatus(workspaceId: string) {
    return this.youtube.getWorkspaceChannelDiagnostics(workspaceId);
  }

  async recordYoutubeConnected(workspaceId: string, userId: string, channel?: { channelId?: string | null; title?: string | null }) {
    await this.audit.record({
      action: 'YOUTUBE_CONNECTED',
      workspaceId,
      userId,
      targetType: 'WorkspaceYoutubeConnection',
      targetId: workspaceId,
      metadata: { channelId: channel?.channelId ?? null, title: channel?.title ?? null },
    });
  }

  async disconnectYoutube(workspaceId: string, actor?: { userId?: string | null }) {
    const result = await this.youtube.disconnectWorkspace(workspaceId);
    await this.audit.record({
      action: 'YOUTUBE_DISCONNECTED',
      workspaceId,
      userId: actor?.userId ?? null,
      targetType: 'WorkspaceYoutubeConnection',
      targetId: workspaceId,
    });
    return result;
  }
}
