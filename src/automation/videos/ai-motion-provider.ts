import { MotionPrompt } from './motion-prompt.builder';

export type CreateMotionClipInput = {
  idempotencyKey: string;
  prompt: MotionPrompt;
  fallbackAssetUrl?: string | null;
};

export type CreateMotionClipResult = {
  provider: 'fake';
  providerJobId: string;
  status: MotionClipStatus;
  clipUrl: string | null;
};

export type MotionClipStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type MotionClipStatusResult = {
  providerJobId: string;
  status: MotionClipStatus;
  clipUrl: string | null;
  failureCode?: string | null;
};

export interface AiMotionProvider {
  createClip(input: CreateMotionClipInput): Promise<CreateMotionClipResult>;
  getClipStatus(providerJobId: string): Promise<MotionClipStatusResult>;
}
