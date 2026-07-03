import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { OAuthStateService } from '../auth/oauth-state.service';
import { YoutubeOAuthError, YoutubeService } from '../common/youtube.service';
import { WorkspacesService } from './workspaces.service';

@Controller('auth/youtube')
@ApiTags('YouTube OAuth')
export class WorkspaceYoutubeOAuthController {
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

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('callback')
  @ApiOperation({ summary: 'Handle workspace YouTube OAuth callback' })
  async callback(
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
}
