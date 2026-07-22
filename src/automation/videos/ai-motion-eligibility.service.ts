import { BadRequestException, Injectable } from '@nestjs/common';
import { aiMotionConfig } from './ai-motion.config';
import { Scene } from './interfaces/scene.interface';

export type AiMotionEligibilityCode =
  | 'ELIGIBLE'
  | 'AI_MOTION_DISABLED'
  | 'AI_MOTION_WORKSPACE_UNAVAILABLE'
  | 'AI_MOTION_INVALID_DURATION'
  | 'AI_MOTION_NO_ELIGIBLE_SCENES'
  | 'AI_MOTION_CREDIT_ESTIMATE_UNAVAILABLE';

export type AiMotionEligibilityResult = {
  eligible: boolean;
  code: AiMotionEligibilityCode;
  message: string;
};

@Injectable()
export class AiMotionEligibilityService {
  validateAiMotionEligibility(input: {
    workspace?: { id: string | null; suspended?: boolean | null } | null;
    scenes: Scene[];
    targetDurationSeconds: number;
  }): AiMotionEligibilityResult {
    const config = aiMotionConfig();
    if (!config.enabled) {
      return {
        eligible: false,
        code: 'AI_MOTION_DISABLED',
        message: 'AI Motion is not available yet.',
      };
    }
    if (!input.workspace?.id || input.workspace.suspended) {
      return {
        eligible: false,
        code: 'AI_MOTION_WORKSPACE_UNAVAILABLE',
        message: 'AI Motion is not available for this workspace.',
      };
    }
    if (
      !Number.isFinite(input.targetDurationSeconds) ||
      input.targetDurationSeconds < 5 ||
      input.targetDurationSeconds > 120
    ) {
      return {
        eligible: false,
        code: 'AI_MOTION_INVALID_DURATION',
        message: 'AI Motion is not available for this video duration.',
      };
    }
    if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
      return {
        eligible: false,
        code: 'AI_MOTION_NO_ELIGIBLE_SCENES',
        message: 'AI Motion needs at least one usable scene.',
      };
    }
    if (!Number.isFinite(config.fakeCreditsPerSecond)) {
      return {
        eligible: false,
        code: 'AI_MOTION_CREDIT_ESTIMATE_UNAVAILABLE',
        message: 'AI Motion credit estimates are unavailable.',
      };
    }
    return {
      eligible: true,
      code: 'ELIGIBLE',
      message: 'AI Motion is available.',
    };
  }

  assertEligible(input: {
    workspace?: { id: string | null; suspended?: boolean | null } | null;
    scenes: Scene[];
    targetDurationSeconds: number;
  }) {
    const result = this.validateAiMotionEligibility(input);
    if (!result.eligible) {
      throw new BadRequestException({
        message: result.message,
        code: result.code,
      });
    }
    return result;
  }
}
