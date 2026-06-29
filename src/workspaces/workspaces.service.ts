import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { YoutubeService } from '../common/youtube.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WorkspacesService {
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

  async createWorkspace(userId: string, dto: { name: string; slug?: string }) {
    const name = String(dto.name || '').trim();
    const slug = this.normalizeSlug(dto.slug || name);
    if (!name) throw new ConflictException('Workspace name is required');

    const workspace = await this.prisma.workspace.create({
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
    await this.audit.record({
      action: 'WORKSPACE_CREATED',
      workspaceId: workspace.id,
      userId,
      targetType: 'Workspace',
      targetId: workspace.id,
      metadata: { slug: workspace.slug },
    });
    return workspace;
  }

  async listMine(userId: string) {
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
