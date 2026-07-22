import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  AiMotionProvider,
  CreateMotionClipInput,
  CreateMotionClipResult,
  MotionClipStatusResult,
} from './ai-motion-provider';
import { aiMotionConfig } from './ai-motion.config';

@Injectable()
export class FakeAiMotionProvider implements AiMotionProvider {
  private readonly jobs = new Map<string, MotionClipStatusResult>();

  createClip(input: CreateMotionClipInput): Promise<CreateMotionClipResult> {
    const config = aiMotionConfig();
    if (!config.fakeProviderEnabled) {
      return Promise.reject(new Error('Fake AI Motion provider is disabled'));
    }
    if (process.env.NODE_ENV === 'production') {
      return Promise.reject(
        new Error('Fake AI Motion provider cannot run in production'),
      );
    }
    if (process.env.AI_MOTION_FAKE_PROVIDER_FORCE_FAILURE === 'true') {
      return Promise.reject(
        new Error('Fake AI Motion provider forced failure'),
      );
    }
    const providerJobId = `fake-motion-${createHash('sha256')
      .update(input.idempotencyKey)
      .digest('hex')
      .slice(0, 24)}`;
    const existing = this.jobs.get(providerJobId);
    if (existing) {
      return Promise.resolve({
        provider: 'fake',
        providerJobId,
        status: existing.status,
        clipUrl: existing.clipUrl,
      });
    }
    const clipUrl = `https://assets.joinjubily.test/fake-ai-motion/${providerJobId}.mp4`;
    const status: MotionClipStatusResult = {
      providerJobId,
      status: 'COMPLETED',
      clipUrl,
    };
    this.jobs.set(providerJobId, status);
    return Promise.resolve({ provider: 'fake', ...status });
  }

  getClipStatus(providerJobId: string): Promise<MotionClipStatusResult> {
    return Promise.resolve(
      this.jobs.get(providerJobId) || {
        providerJobId,
        status: 'FAILED',
        clipUrl: null,
        failureCode: 'FAKE_JOB_NOT_FOUND',
      },
    );
  }
}
