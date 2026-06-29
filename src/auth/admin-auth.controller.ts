/* eslint-disable prettier/prettier */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiFoundResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { AdminGuard } from './admin.guard';
import { YoutubeService } from '../common/youtube.service';
import { OAuthStateService } from './oauth-state.service';

type AdminRequest = Request & {
  user: {
    adminId?: string;
    email: string;
    role: string;
    kind?: 'admin' | 'user';
  };
};

function requestMeta(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') || undefined,
  };
}

@Controller('admin/auth')
@ApiTags('Admin Auth')
@ApiBearerAuth('jwt')
export class AdminAuthController {
  private readonly youtubeOAuthStateTtlMs = 10 * 60 * 1000;

  constructor(
    private readonly auth: AuthService,
    private readonly youtube: YoutubeService,
    private readonly oauthStates: OAuthStateService,
  ) {}

  private getCookie(req: Request, name: string): string | null {
    const header = req.headers.cookie;
    if (!header) return null;

    const prefix = `${name}=`;
    for (const part of header.split(';')) {
      const item = part.trim();
      if (!item.startsWith(prefix)) continue;
      return decodeURIComponent(item.slice(prefix.length));
    }

    return null;
  }

  private async storePendingYoutubeState(req: AdminRequest) {
    if (!req.user.adminId || req.user.kind !== 'admin') throw new UnauthorizedException('Admin token required');
    const adminEmail = this.auth.ensureAdminEmailAllowed(req.user.email);
    const state = await this.oauthStates.create({
      purpose: 'admin_youtube',
      adminId: req.user.adminId,
      adminEmail,
      ttlMs: this.youtubeOAuthStateTtlMs,
    });

    return { state, adminEmail };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Authenticate an admin user', description: 'Public admin endpoint. Returns an admin JWT with kind: "admin".' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ description: 'Admin login succeeded.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  login(@Req() req: Request, @Body() dto: LoginDto) {
    return this.auth.adminLogin(dto.email, dto.password, requestMeta(req));
  }

  @Get('me')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get the current admin profile', description: 'Requires an admin bearer token.' })
  me(@Req() req: AdminRequest) {
    return this.auth.me({ adminId: req.user.adminId });
  }

  @Get('youtube')
  @UseGuards(ThrottlerGuard, AdminGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start admin YouTube OAuth connection', description: 'Admin-only endpoint. Redirects the admin to Google OAuth.' })
  @ApiFoundResponse({ description: 'Redirects to the Google OAuth consent URL.' })
  async youtubeAuth(@Req() req: AdminRequest, @Res() res: Response) {
    const { state, adminEmail } = await this.storePendingYoutubeState(req);

    res.cookie('yt_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: this.youtubeOAuthStateTtlMs,
      path: '/admin/auth/youtube/callback',
    });

    res.cookie('yt_oauth_email', adminEmail, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: this.youtubeOAuthStateTtlMs,
      path: '/admin/auth/youtube/callback',
    });

    return res.redirect(String(this.youtube.getAdminAuthUrl(state)));
  }

  @Post('youtube/connect')
  @UseGuards(ThrottlerGuard, AdminGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create an admin YouTube OAuth connection URL', description: 'Admin-only endpoint.' })
  @ApiOkResponse({ description: 'Google OAuth consent URL.' })
  async youtubeConnect(@Req() req: AdminRequest) {
    const { state } = await this.storePendingYoutubeState(req);
    return { url: String(this.youtube.getAdminAuthUrl(state)) };
  }

  @Get('youtube/channel')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get connected YouTube channel diagnostics', description: 'Admin-only endpoint.' })
  youtubeChannel() {
    return this.youtube.getChannelDiagnostics();
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('youtube/callback')
  @ApiOperation({ summary: 'Handle admin YouTube OAuth callback', description: 'Public callback used by Google OAuth. Persisted state validates the request.' })
  async youtubeCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    if (!code) throw new BadRequestException('Missing OAuth code');

    this.getCookie(req, 'yt_oauth_state');
    res.clearCookie('yt_oauth_state', { path: '/admin/auth/youtube/callback' });
    res.clearCookie('yt_oauth_email', { path: '/admin/auth/youtube/callback' });

    const pending = await this.oauthStates.consume('admin_youtube', state);
    if (!pending?.adminEmail) throw new UnauthorizedException('Invalid OAuth state');
    this.auth.ensureAdminEmailAllowed(pending.adminEmail);

    await this.youtube.handleAuthCallback(code);
    return res.status(200).send('YouTube connected. You can close this tab.');
  }
}
