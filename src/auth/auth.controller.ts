/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from './public.decorator';
import type { Request } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from './roles.decorator';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

type AuthenticatedRequest = Request & {
  user: {
    adminId?: string;
    userId?: string;
    email: string;
    role: string;
    kind?: 'user';
    emailVerified?: boolean;
  };
};

function requestMeta(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') || undefined,
  };
}

@Controller('auth')
@ApiTags('Auth')
@ApiBearerAuth('jwt')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Authenticate a SaaS user', description: 'Public endpoint. Returns a customer JWT with kind: "user". Admin login is POST /admin/auth/login.' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Customer login succeeded.',
    schema: { example: { accessToken: 'eyJhbGciOi...', refreshToken: 'refresh-token', user: { id: '7f8d41e2-0dd8-48ea-a143-b2f8dfc21bcb', email: 'user@example.com', name: 'Jane' } } },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  login(@Req() req: Request, @Body() dto: LoginDto) {
    return this.auth.customerLogin(dto.email, dto.password, requestMeta(req));
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  @ApiOperation({ summary: 'Create a SaaS user account', description: 'Public endpoint. Returns a JWT access token for workspace-scoped routes.' })
  @ApiBody({ type: SignupDto })
  @ApiOkResponse({
    description: 'Signup succeeded.',
    schema: { example: { accessToken: 'eyJhbGciOi...', user: { id: '7f8d41e2-0dd8-48ea-a143-b2f8dfc21bcb', email: 'user@example.com', name: 'Jane' } } },
  })
  signup(@Req() req: Request, @Body() dto: SignupDto) {
    return this.auth.signup(dto.email, dto.password, dto.name, requestMeta(req), dto.promoCode, {
      acceptedTerms: dto.acceptedTerms,
      acceptedPrivacyPolicy: dto.acceptedPrivacyPolicy,
    });
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-email')
  @ApiOperation({ summary: 'Verify a SaaS user email address' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-verification')
  @ApiOperation({ summary: 'Resend the verification email for an unverified account' })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset email' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset a user password with a one-time token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token and issue a new access token' })
  refresh(@Req() req: Request, @Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken, requestMeta(req));
  }

  @Post('logout')
  @Roles('USER')
  @ApiOperation({ summary: 'Log out the current refresh session' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @Roles('USER')
  @ApiOperation({ summary: 'Log out all refresh sessions for the current SaaS user' })
  logoutAll(@Req() req: AuthenticatedRequest) {
    if (!req.user?.userId) throw new UnauthorizedException('SaaS user token required');
    return this.auth.logoutAll(req.user.userId);
  }

  @Get('me')
  @Roles('USER')
  @ApiOperation({ summary: 'Get the current SaaS user profile', description: 'Requires a valid customer bearer token.' })
  @ApiOkResponse({
    description: 'Authenticated customer profile.',
    schema: { example: { kind: 'user', user: { id: '7f8d41e2-0dd8-48ea-a143-b2f8dfc21bcb', email: 'user@example.com' } } },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.' })
  me(@Req() req: AuthenticatedRequest) {
    if (!req.user?.userId || req.user.kind !== 'user') throw new UnauthorizedException('SaaS user token required');
    return this.auth.me({ userId: req.user.userId });
  }
}
