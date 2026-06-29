import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { WorkspaceRequest } from './workspace.types';

export const ActiveWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<WorkspaceRequest>();
    return req.workspace ?? null;
  },
);
