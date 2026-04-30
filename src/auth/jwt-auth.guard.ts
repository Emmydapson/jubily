/* eslint-disable prettier/prettier */
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  private isPublicPath(path: string) {
    const normalized = String(path || '').toLowerCase();
    return (
      normalized.startsWith('/r/') ||
      normalized.startsWith('/webhooks/digistore24') ||
      normalized.startsWith('/webhooks/clickbank') ||
      normalized === '/monitoring/pipeline/health'
    );
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    if (this.isPublicPath(req?.path || req?.originalUrl || '')) return true;

    return super.canActivate(context);
  }
}
