import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

type AdminRequest = {
  user?: {
    adminId?: string;
    kind?: string;
  };
};

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    if (req.user?.kind === 'admin' && req.user.adminId) return true;
    throw new ForbiddenException('Admin token required');
  }
}
