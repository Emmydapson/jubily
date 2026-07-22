import { Injectable } from '@nestjs/common';
import { Scene } from './interfaces/scene.interface';

export type MotionPrompt = {
  subject: string;
  action: string;
  environment?: string;
  cameraMovement: string;
  style: string;
  durationSeconds: number;
  aspectRatio: '9:16' | '16:9' | '1:1';
  negativeConstraints: string[];
};

const MAX_FIELD = 180;

function clean(value: string | null | undefined, fallback: string) {
  const sanitized = String(value || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[^\w\s.,:;!?'"()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (sanitized || fallback).slice(0, MAX_FIELD);
}

function aspectRatioFor(platform: string) {
  const normalized = platform.toUpperCase();
  if (normalized.includes('YOUTUBE') || normalized.includes('TIKTOK')) {
    return '9:16' as const;
  }
  if (normalized.includes('INSTAGRAM')) return '9:16' as const;
  return '9:16' as const;
}

@Injectable()
export class MotionPromptBuilder {
  build(input: {
    scene: Scene;
    platform: string;
    offerName?: string | null;
    movement?: string | null;
  }): MotionPrompt {
    const visual = clean(input.scene.visualPrompt, 'product demonstration');
    const narration = clean(input.scene.narration, 'show the product benefit');
    const offer = clean(input.offerName, 'the promoted product');
    const prompt: MotionPrompt = {
      subject: clean(`${offer}: ${visual}`, 'the promoted product'),
      action: narration,
      environment: visual,
      cameraMovement: clean(input.movement, 'subtle push-in'),
      style:
        'realistic vertical short-form promotional video, natural lighting, brand-safe',
      durationSeconds: Math.max(2, Math.min(6, Number(input.scene.duration))),
      aspectRatio: aspectRatioFor(input.platform),
      negativeConstraints: [
        'no readable text inside generated video',
        'no affiliate URLs',
        'no logos unless supplied as trusted assets',
        'no distorted faces or hands',
        'no unrelated product category',
      ],
    };
    this.validate(prompt);
    return prompt;
  }

  validate(prompt: MotionPrompt) {
    const fields = [prompt.subject, prompt.action, prompt.cameraMovement];
    if (fields.some((field) => !field || field.length > MAX_FIELD)) {
      throw new Error('Motion prompt fields must be bounded and non-empty');
    }
    if (!['9:16', '16:9', '1:1'].includes(prompt.aspectRatio)) {
      throw new Error('Motion prompt aspect ratio is unsupported');
    }
    if (
      !Number.isFinite(prompt.durationSeconds) ||
      prompt.durationSeconds <= 0 ||
      prompt.durationSeconds > 10
    ) {
      throw new Error('Motion prompt duration is unsupported');
    }
  }
}
