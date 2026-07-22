import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Scene } from './interfaces/scene.interface';
import { MotionPrompt, MotionPromptBuilder } from './motion-prompt.builder';

export const AI_MOTION_PLANNER_VERSION = 'ai-motion-planner-v1';

export type MotionSceneSelection = {
  sceneIndex: number;
  sourceSceneIndex: number;
  reason: string;
  plannedClipDuration: number;
  prompt: MotionPrompt;
  idempotencyKeySeed: string;
  fallbackAssetUrl: string | null;
};

export type MotionSceneRejection = {
  sceneIndex: number;
  sourceSceneIndex: number;
  reason: string;
};

export type MotionScenePlan = {
  selectedScenes: MotionSceneSelection[];
  rejectedScenes: MotionSceneRejection[];
  estimatedMotionSeconds: number;
  planningVersion: string;
};

const POOR_CANDIDATE =
  /logo|disclaimer|legal|terms|privacy|cta|call to action|subscribe|link in|coupon|code|screenshot|dashboard|chart|table|text-heavy/i;
const STRONG_CANDIDATE =
  /hook|demo|demonstrat|show|move|transform|before|after|result|proof|human|walk|use|open|unbox|try|product|benefit|pain/i;

function capForDuration(seconds: number) {
  if (seconds <= 30) return 2;
  if (seconds <= 45) return 3;
  if (seconds <= 60) return 4;
  return 5;
}

function scoreScene(scene: Scene, index: number, isLast: boolean) {
  const text = `${scene.caption} ${scene.narration} ${scene.visualPrompt}`;
  if (isLast || POOR_CANDIDATE.test(text) || scene.duration < 2) return -100;
  let score = 0;
  if (index === 0) score += 8;
  if (STRONG_CANDIDATE.test(text)) score += 5;
  if (/product|demo|screen|use|try/i.test(text)) score += 4;
  if (/before|after|transform|result|proof/i.test(text)) score += 3;
  score += Math.min(3, Math.max(0, scene.duration - 2));
  return score;
}

@Injectable()
export class MotionScenePlannerService {
  constructor(private readonly promptBuilder: MotionPromptBuilder) {}

  plan(input: {
    scenes: Scene[];
    targetDurationSeconds: number;
    platform: string;
    offerName?: string | null;
    availableProductMedia?: Array<{ url: string; type?: string | null }>;
  }): MotionScenePlan {
    const cap = capForDuration(input.targetDurationSeconds);
    const media = input.availableProductMedia || [];
    const candidates = input.scenes.map((scene, position) => ({
      scene,
      position,
      score: scoreScene(scene, position, position === input.scenes.length - 1),
    }));
    const selectedIndexes = new Set(
      candidates
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.position - b.position)
        .slice(0, cap)
        .map((candidate) => candidate.scene.index),
    );

    const selectedScenes: MotionSceneSelection[] = [];
    const rejectedScenes: MotionSceneRejection[] = [];

    for (const [position, scene] of input.scenes.entries()) {
      const isLast = position === input.scenes.length - 1;
      const sourceSceneIndex = scene.index;
      if (!selectedIndexes.has(scene.index)) {
        rejectedScenes.push({
          sceneIndex: scene.index,
          sourceSceneIndex,
          reason:
            scoreScene(scene, position, isLast) < 0
              ? 'Poor motion candidate'
              : 'Outside motion scene cap',
        });
        continue;
      }

      const prompt = this.promptBuilder.build({
        scene,
        platform: input.platform,
        offerName: input.offerName,
        movement:
          scene.index === 0
            ? 'subtle hook push-in'
            : 'natural product movement',
      });
      const fallbackAsset = media.find((item) =>
        /^https?:\/\//i.test(item.url),
      );
      const seed = createHash('sha256')
        .update(
          `${AI_MOTION_PLANNER_VERSION}:${scene.index}:${scene.narration}`,
        )
        .digest('hex')
        .slice(0, 24);
      selectedScenes.push({
        sceneIndex: scene.index,
        sourceSceneIndex,
        reason: scene.index === 0 ? 'Opening hook' : 'Product or proof moment',
        plannedClipDuration: prompt.durationSeconds,
        prompt,
        idempotencyKeySeed: seed,
        fallbackAssetUrl: fallbackAsset?.url ?? null,
      });
    }

    selectedScenes.sort((a, b) => a.sceneIndex - b.sceneIndex);
    return {
      selectedScenes,
      rejectedScenes,
      estimatedMotionSeconds: selectedScenes.reduce(
        (sum, scene) => sum + scene.plannedClipDuration,
        0,
      ),
      planningVersion: AI_MOTION_PLANNER_VERSION,
    };
  }
}
