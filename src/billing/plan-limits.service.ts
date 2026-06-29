import { Injectable } from '@nestjs/common';
import { Plan } from '@prisma/client';

export type PlanLimits = {
  videoGenerations: number;
  publishes: number;
  aiGenerations: number;
  renderMinutes: number;
  storageBytes: bigint;
};

@Injectable()
export class PlanLimitsService {
  private readonly limits: Record<Plan, PlanLimits> = {
    FREE: {
      videoGenerations: 3,
      publishes: 1,
      aiGenerations: 10,
      renderMinutes: 90,
      storageBytes: 500n * 1024n * 1024n,
    },
    PRO: {
      videoGenerations: 50,
      publishes: 25,
      aiGenerations: 200,
      renderMinutes: 1500,
      storageBytes: 10n * 1024n * 1024n * 1024n,
    },
    PREMIUM: {
      videoGenerations: 200,
      publishes: 100,
      aiGenerations: 1000,
      renderMinutes: 6000,
      storageBytes: 50n * 1024n * 1024n * 1024n,
    },
  };

  getLimits(plan: Plan): PlanLimits {
    return this.limits[plan] ?? this.limits.FREE;
  }

  listPlans() {
    return (Object.keys(this.limits) as Plan[]).map((plan) => ({
      plan,
      limits: this.serializeLimits(this.getLimits(plan)),
    }));
  }

  serializeLimits(limits: PlanLimits) {
    return {
      ...limits,
      storageBytes: limits.storageBytes.toString(),
    };
  }
}
