import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { OAuthStateService } from '../auth/oauth-state.service';
import { ActiveWorkspace } from '../workspaces/workspace.decorator';
import { WorkspaceRoles } from '../workspaces/workspace-roles.decorator';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import type { WorkspaceRequest } from '../workspaces/workspace.types';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SocialAccountsService } from './social-accounts.service';

@ApiTags('Publishing OAuth')
@ApiBearerAuth('jwt')
@Controller('auth')
export class SocialOAuthController {
  private readonly stateTtlMs = 10 * 60 * 1000;

  constructor(
    private readonly accounts: SocialAccountsService,
    private readonly oauthStates: OAuthStateService,
    private readonly workspaces: WorkspacesService,
  ) {}

  private frontendPublishingUrl(params: Record<string, string>) {
    const base = String(
      process.env.FRONTEND_URL || 'https://joinjubily.com',
    ).replace(/\/+$/, '');
    const url = new URL(`${base}/publishing`);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    return url.toString();
  }

  @Get('tiktok/connect')
  @UseGuards(ThrottlerGuard, WorkspaceGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a workspace-scoped TikTok OAuth URL' })
  async tiktokConnect(
    @Req() req: WorkspaceRequest,
    @ActiveWorkspace() workspace: { id: string },
  ) {
    if (!req.user?.userId)
      throw new UnauthorizedException('SaaS user token required');
    const state = await this.oauthStates.create({
      purpose: 'workspace_tiktok',
      workspaceId: workspace.id,
      userId: req.user.userId,
      ttlMs: this.stateTtlMs,
    });
    return { url: this.accounts.createTikTokAuthUrl(state) };
  }

  @Public()
  @Get('tiktok/callback')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Handle TikTok OAuth callback' })
  async tiktokCallback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    if (!code)
      return res.redirect(
        this.frontendPublishingUrl({ error: 'TIKTOK_TOKEN_EXCHANGE_FAILED' }),
      );
    const pending = await this.oauthStates.consume('workspace_tiktok', state);
    if (!pending?.workspaceId || !pending.userId) {
      return res.redirect(
        this.frontendPublishingUrl({ error: 'INVALID_CALLBACK_STATE' }),
      );
    }
    try {
      await this.workspaces.requireMembership(
        pending.workspaceId,
        pending.userId,
        ['OWNER', 'ADMIN'],
      );
      await this.accounts.handleTikTokCallback(
        pending.workspaceId,
        pending.userId,
        code,
      );
      return res.redirect(this.frontendPublishingUrl({ connected: 'tiktok' }));
    } catch {
      return res.redirect(
        this.frontendPublishingUrl({ error: 'TIKTOK_CONNECTION_FAILED' }),
      );
    }
  }

  @Get('facebook/connect')
  @UseGuards(ThrottlerGuard, WorkspaceGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a workspace-scoped Facebook OAuth URL' })
  async facebookConnect(
    @Req() req: WorkspaceRequest,
    @ActiveWorkspace() workspace: { id: string },
  ) {
    if (!req.user?.userId)
      throw new UnauthorizedException('SaaS user token required');
    const state = await this.oauthStates.create({
      purpose: 'workspace_facebook',
      workspaceId: workspace.id,
      userId: req.user.userId,
      ttlMs: this.stateTtlMs,
    });
    return { url: this.accounts.createFacebookAuthUrl(state) };
  }

  @Public()
  @Get('facebook/callback')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Handle Facebook OAuth callback' })
  async facebookCallback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    if (!code)
      return res.redirect(
        this.frontendPublishingUrl({ error: 'FACEBOOK_TOKEN_EXCHANGE_FAILED' }),
      );
    const pending = await this.oauthStates.consume('workspace_facebook', state);
    if (!pending?.workspaceId || !pending.userId) {
      return res.redirect(
        this.frontendPublishingUrl({ error: 'INVALID_CALLBACK_STATE' }),
      );
    }
    try {
      await this.workspaces.requireMembership(
        pending.workspaceId,
        pending.userId,
        ['OWNER', 'ADMIN'],
      );
      await this.accounts.handleFacebookCallback(
        pending.workspaceId,
        pending.userId,
        code,
      );
      return res.redirect(
        this.frontendPublishingUrl({ connected: 'facebook' }),
      );
    } catch {
      return res.redirect(
        this.frontendPublishingUrl({ error: 'FACEBOOK_CONNECTION_FAILED' }),
      );
    }
  }
}
