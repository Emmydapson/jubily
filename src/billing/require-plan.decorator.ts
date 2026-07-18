import { SetMetadata } from '@nestjs/common';
import { Plan } from '@prisma/client';

export const REQUIRED_PLAN_KEY = 'requiredPlan';
export const RequirePlan = (...plans: Plan[]) =>
  SetMetadata(REQUIRED_PLAN_KEY, plans);
