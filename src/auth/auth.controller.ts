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
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';
import { YoutubeService } from '../common/youtube.service';
import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from './roles.decorator';
import { ApiBearerAuth, ApiBody, ApiFoundResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

type AuthenticatedRequest = Request & {
  user: {
    adminId: string;
    email: string;
    role: string;
  };
};

@Controller('auth')
@Roles('ADMIN')
@ApiTags('Auth')
@ApiBearerAuth('jwt')
export class AuthController {
  constructor(private auth: AuthService,
    private youtube: YoutubeService,
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

  private stateMatches(expected: string | null, actual?: string) {
    if (!expected || !actual) return false;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(actual, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // Public because this is the admin login entrypoint; throttling limits brute-force attempts.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Authenticate an admin user', description: 'Public endpoint. Returns a JWT access token for protected admin routes.' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Admin login succeeded.',
    schema: { example: { accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', admin: { id: '7f8d41e2-0dd8-48ea-a143-b2f8dfc21bcb', email: 'admin@joinjubily.com', role: 'ADMIN' } } },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the current admin profile', description: 'Requires a valid ADMIN bearer token.' })
  @ApiOkResponse({
    description: 'Authenticated admin profile.',
    schema: { example: { id: '7f8d41e2-0dd8-48ea-a143-b2f8dfc21bcb', email: 'admin@joinjubily.com', role: 'ADMIN' } },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.' })
  me(@Req() req: AuthenticatedRequest) {
    // req.user from JwtStrategy.validate
    return this.auth.me(req.user.adminId);
  }

  // Protected: only authenticated admin can initiate channel connection
  @Get('youtube')
  @ApiOperation({ summary: 'Start YouTube OAuth connection', description: 'Requires a valid ADMIN bearer token and redirects the admin to Google OAuth.' })
  @ApiFoundResponse({ description: 'Redirects to the Google OAuth consent URL.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.' })
  youtubeAuth(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const adminEmail = this.auth.ensureAdminEmailAllowed(req.user.email);
    const state = randomBytes(24).toString('hex');

    res.cookie('yt_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60 * 1000, // 10 min
      path: '/auth/youtube/callback',
    });

    res.cookie('yt_oauth_email', adminEmail, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60 * 1000,
      path: '/auth/youtube/callback',
    });

    const url = String(this.youtube.getAuthUrl(state));
    return res.redirect(url);
  }

  // Public because YouTube redirects here without a bearer token; state cookies validate the request.
  @Public()
  @Get('youtube/callback')
  @ApiOperation({ summary: 'Handle YouTube OAuth callback', description: 'Public callback used by Google OAuth. State cookies validate the request.' })
  @ApiOkResponse({ description: 'YouTube account connected.', schema: { example: 'YouTube connected. You can close this tab.' } })
  @ApiResponse({ status: 400, description: 'Missing OAuth code.' })
  @ApiResponse({ status: 401, description: 'Invalid OAuth state.' })
  async youtubeCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    if (!code) throw new BadRequestException('Missing OAuth code');

    const expected = this.getCookie(req, 'yt_oauth_state');
    const adminEmail = this.getCookie(req, 'yt_oauth_email');
    res.clearCookie('yt_oauth_state', { path: '/auth/youtube/callback' });
    res.clearCookie('yt_oauth_email', { path: '/auth/youtube/callback' });

    if (!this.stateMatches(expected, state)) {
      throw new UnauthorizedException('Invalid OAuth state');
    }

    this.auth.ensureAdminEmailAllowed(adminEmail || '');

    await this.youtube.handleAuthCallback(code);
    return res.status(200).send('✅ YouTube connected. You can close this tab.');
  }
}
