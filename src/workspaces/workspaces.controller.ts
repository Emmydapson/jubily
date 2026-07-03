import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ForbiddenException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { YoutubeOAuthError, YoutubeService } from '../common/youtube.service';
import { ActiveWorkspace } from './workspace.decorator';
import { WorkspaceRoles } from './workspace-roles.decorator';
import { WorkspaceGuard } from './workspace.guard';
import type { WorkspaceRequest } from './workspace.types';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceProfileDto } from './dto/update-workspace-profile.dto';
import { OAuthStateService } from '../auth/oauth-state.service';

@Controller('workspaces')
@ApiTags('Workspaces')
@ApiBearerAuth('jwt')
export class WorkspacesController {
  private readonly youtubeOAuthStateTtlMs = 10 * 60 * 1000;

  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly youtube: YoutubeService,
    private readonly oauthStates: OAuthStateService,
  ) {}

  private frontendYoutubeUrl(params: Record<string, string>) {
    const base = String(process.env.FRONTEND_URL || 'https://joinjubily.com').replace(/\/+$/, '');
    const url = new URL(`${base}/youtube`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }

  private asYoutubeBadRequest(error: unknown) {
    if (error instanceof YoutubeOAuthError) {
      return new BadRequestException({ error: error.code, message: error.message });
    }
    throw error;
  }

  @Post()
  @ApiOperation({ summary: 'Create a workspace for the current SaaS user' })
  @ApiBody({ type: CreateWorkspaceDto })
  create(@Req() req: WorkspaceRequest, @Body() dto: CreateWorkspaceDto) {
    if (!req.user?.userId) throw new UnauthorizedException('SaaS user token required');
    if (req.user.emailVerified === false) throw new ForbiddenException('Email verification required');
    return this.workspaces.createWorkspace(req.user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List workspaces for the current SaaS user' })
  listMine(@Req() req: WorkspaceRequest) {
    if (!req.user?.userId) throw new UnauthorizedException('SaaS user token required');
    return this.workspaces.listMine(req.user.userId);
  }

  @Get(':workspaceId/dashboard')
  @UseGuards(WorkspaceGuard)
  @ApiOperation({ summary: 'Get workspace dashboard summary' })
  dashboard(@ActiveWorkspace() workspace: { id: string }) {
    return this.workspaces.dashboardSummary(workspace.id);
  }

  @Get(':workspaceId/profile')
  @UseGuards(WorkspaceGuard)
  @ApiOperation({ summary: 'Get workspace affiliate onboarding profile' })
  profile(@ActiveWorkspace() workspace: { id: string }) {
    return this.workspaces.getProfile(workspace.id);
  }

  @Patch(':workspaceId/profile')
  @UseGuards(WorkspaceGuard)
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update workspace affiliate onboarding profile' })
  updateProfile(@ActiveWorkspace() workspace: { id: string }, @Body() dto: UpdateWorkspaceProfileDto) {
    return this.workspaces.updateProfile(workspace.id, dto);
  }

  @Get(':workspaceId/youtube')
  @UseGuards(WorkspaceGuard)
  @ApiOperation({ summary: 'Get workspace YouTube connection status' })
  youtubeStatus(@ActiveWorkspace() workspace: { id: string }) {
    return this.workspaces.getYoutubeStatus(workspace.id);
  }

  @Post(':workspaceId/youtube/connect')
  @UseGuards(ThrottlerGuard, WorkspaceGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a workspace-scoped YouTube OAuth URL' })
  @ApiOkResponse({ description: 'Google OAuth consent URL.', schema: { example: { url: 'https://accounts.google.com/o/oauth2/v2/auth?...' } } })
  async youtubeConnect(
    @Req() req: WorkspaceRequest,
    @ActiveWorkspace() workspace: { id: string },
  ) {
    if (!req.user?.userId) throw new UnauthorizedException('SaaS user token required');
    if (!workspace?.id) {
      throw new BadRequestException({
        error: 'MISSING_WORKSPACE',
        message: 'Workspace context is required for YouTube OAuth.',
      });
    }
    const state = await this.oauthStates.create({
      purpose: 'workspace_youtube',
      workspaceId: workspace.id,
      userId: req.user.userId,
      ttlMs: this.youtubeOAuthStateTtlMs,
    });
    try {
      return { url: String(this.youtube.getCustomerAuthUrl(state)) };
    } catch (error: unknown) {
      throw this.asYoutubeBadRequest(error);
    }
  }

  @Delete(':workspaceId/youtube')
  @UseGuards(WorkspaceGuard)
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Disconnect workspace YouTube account' })
  disconnectYoutube(@Req() req: WorkspaceRequest, @ActiveWorkspace() workspace: { id: string }) {
    return this.workspaces.disconnectYoutube(workspace.id, { userId: req.user?.userId });
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('youtube/callback')
  @ApiOperation({ summary: 'Handle workspace YouTube OAuth callback' })
  async youtubeCallback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    if (!code) return res.redirect(this.frontendYoutubeUrl({ error: 'TOKEN_EXCHANGE_FAILED' }));
    const pending = await this.oauthStates.consume('workspace_youtube', state);
    if (!pending?.workspaceId || !pending.userId) {
      return res.redirect(this.frontendYoutubeUrl({ error: 'INVALID_CALLBACK_STATE' }));
    }
    try {
      await this.workspaces.requireMembership(pending.workspaceId, pending.userId, ['OWNER', 'ADMIN']);
      const channel = await this.youtube.handleWorkspaceAuthCallback(pending.workspaceId, code, pending.userId);
      await this.workspaces.recordYoutubeConnected(pending.workspaceId, pending.userId, channel);
      return res.redirect(this.frontendYoutubeUrl({ connected: 'true' }));
    } catch (error: unknown) {
      if (error instanceof YoutubeOAuthError) {
        return res.redirect(this.frontendYoutubeUrl({ error: error.code }));
      }
      throw error;
    }
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceGuard)
  @ApiOperation({ summary: 'Select/get active workspace' })
  select(@Param('workspaceId', ParseUUIDPipe) workspaceId: string, @ActiveWorkspace() workspace: { id: string; role: string }) {
    return { id: workspaceId, role: workspace.role };
  }
}
