/* eslint-disable prettier/prettier */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

type AuthenticatedRequest = {
  user?: {
    role?: string;
    kind?: 'admin' | 'user';
  };
};

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles?.length) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userRole = String(req.user?.role || '');

    if (req.user?.kind === 'admin' && roles.includes('ADMIN') && ADMIN_ROLES.has(userRole)) return true;
    if (req.user?.kind === 'user' && roles.includes('USER') && userRole === 'USER') return true;
    if (roles.includes(userRole)) return true;

    throw new ForbiddenException('Insufficient role');
  }
}
