/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { VideosModule } from "../automation/videos/videos.module"
import { ThrottlerModule } from '@nestjs/throttler';
import { getJwtExpiresIn, getJwtSecret } from './jwt.config';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: getJwtExpiresIn() },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 5,
      },
    ]),
    VideosModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
