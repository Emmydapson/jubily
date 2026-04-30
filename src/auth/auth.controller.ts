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
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';
import { YoutubeService } from '../common/youtube.service';
import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';

@Controller('auth')
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

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  me(@Req() req: any) {
    // req.user from JwtStrategy.validate
    return this.auth.me(req.user.adminId);
  }

  // Protected: only authenticated admin can initiate channel connection
  @Get('youtube')
  youtubeAuth(@Req() req: any, @Res() res: Response) {
    const adminEmail = this.auth.ensureAdminEmailAllowed(req?.user?.email || '');
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

    const url = this.youtube.getAuthUrl(state);
    return res.redirect(url);
  }

  // ✅ ADD THIS
  @Public()
  @Get('youtube/callback')
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
