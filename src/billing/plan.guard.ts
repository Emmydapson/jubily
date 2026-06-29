import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Plan } from '@prisma/client';
import { WorkspaceRequest } from '../workspaces/workspace.types';
import { REQUIRED_PLAN_KEY } from './require-plan.decorator';
import { BillingService } from './billing.service';

const PLAN_ORDER: Record<Plan, number> = { FREE: 1, PRO: 2, PREMIUM: 3 };

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Plan[]>(REQUIRED_PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<WorkspaceRequest>();
    const workspaceId = req.workspace?.id;
    if (!workspaceId) throw new ForbiddenException('Workspace is required');

    const subscription = await this.billing.getOrCreateSubscription(workspaceId);
    const effectivePlan = this.billing.effectivePlan(subscription);
    const minimum = Math.min(...required.map((plan) => PLAN_ORDER[plan]));
    if (PLAN_ORDER[effectivePlan] < minimum) {
      throw new ForbiddenException(`Plan ${required.join(' or ')} is required`);
    }

    return true;
  }
}
