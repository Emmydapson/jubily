import { Injectable } from '@nestjs/common';
import { aiMotionConfig } from './ai-motion.config';
import { MotionScenePlan } from './motion-scene-planner.service';

export type AiMotionCreditEstimate = {
  totalCredits: number;
  motionSceneCount: number;
  totalMotionSeconds: number;
  pricingVersion: string;
  isFinal: boolean;
};

@Injectable()
export class AiMotionCreditEstimatorService {
  estimate(plan: MotionScenePlan): AiMotionCreditEstimate {
    const config = aiMotionConfig();
    const seconds = Number(plan.estimatedMotionSeconds.toFixed(2));
    return {
      totalCredits: Math.ceil(
        config.fakeBaseCredits + seconds * config.fakeCreditsPerSecond,
      ),
      motionSceneCount: plan.selectedScenes.length,
      totalMotionSeconds: seconds,
      pricingVersion: `fake-motion-pricing-v1:${config.fakeCreditsPerSecond}/s`,
      isFinal: false,
    };
  }
}
