/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';
import { YoutubeService } from '../common/youtube.service';
import { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService,
    private youtube: YoutubeService,
  ) {}

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

  // ✅ ADD THIS
  @Public()
  @Get('youtube')
  youtubeAuth(@Res() res) {
    const url = this.youtube.getAuthUrl();
    return res.redirect(url);
  }

  // ✅ ADD THIS
  @Public()
  @Get('youtube/callback')
  async youtubeCallback(@Query('code') code: string) {
    await this.youtube.handleAuthCallback(code);
    return '✅ YouTube connected. You can close this tab.';
  }
}
