/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AdminAuthController } from './admin-auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { VideosModule } from "../automation/videos/videos.module"
import { getJwtExpiresIn, getJwtSecret } from './jwt.config';
import { AuditModule } from '../audit/audit.module';
import { AuthEmailService } from './auth-email.service';
import { OAuthStateService } from './oauth-state.service';
import { EmailOutboxWorker } from './email-outbox.worker';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: getJwtExpiresIn() },
    }),
    VideosModule,
    AuditModule,
  ],
  controllers: [AuthController, AdminAuthController],
  providers: [AuthService, JwtStrategy, AuthEmailService, OAuthStateService, EmailOutboxWorker, AdminGuard],
  exports: [AuthService, OAuthStateService],
})
export class AuthModule {}
