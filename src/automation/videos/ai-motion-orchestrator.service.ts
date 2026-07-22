import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MonitoringService } from '../../monitoring/monitoring.service';
import { extractScenes } from '../scene.parser';
import { aiMotionConfig } from './ai-motion.config';
import { AiMotionCreditEstimatorService } from './ai-motion-credit-estimator.service';
import { AiMotionEligibilityService } from './ai-motion-eligibility.service';
import { FakeAiMotionProvider } from './fake-ai-motion.provider';
import {
  MotionFallbackPolicy,
  MotionPlanningStatus,
  VideoGenerationMode,
} from './generation-mode';
import {
  AI_MOTION_PLANNER_VERSION,
  MotionScenePlannerService,
} from './motion-scene-planner.service';

function sceneAttemptKey(input: {
  videoJobId: string;
  sceneIndex: number;
  plannerVersion: string;
  attempt: number;
}) {
  return createHash('sha256')
    .update(
      `${input.videoJobId}:${input.sceneIndex}:${input.plannerVersion}:${input.attempt}`,
    )
    .digest('hex');
}

@Injectable()
export class AiMotionOrchestratorService {
  private readonly logger = new Logger(AiMotionOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: AiMotionEligibilityService,
    private readonly planner: MotionScenePlannerService,
    private readonly estimator: AiMotionCreditEstimatorService,
    private readonly fakeProvider: FakeAiMotionProvider,
    private readonly monitoring: MonitoringService,
  ) {}

  async prepareJob(videoJobId: string) {
    const job = await this.prisma.videoJob.findUnique({
      where: { id: videoJobId },
      include: {
        workspace: { select: { id: true, suspended: true } },
        offer: { select: { id: true, name: true } },
        script: { select: { id: true, content: true } },
      },
    });
    if (!job || job.generationMode !== 'AI_MOTION') return null;
    const scenes = extractScenes(job.script.content);
    const targetDurationSeconds = scenes.reduce(
      (sum, scene) => sum + Number(scene.duration || 0),
      0,
    );

    await this.monitoring.info({
      stage: 'RENDER',
      status: 'AiMotionPlanningStarted',
      message: 'AI Motion planning started',
      jobId: videoJobId,
      offerId: job.offerId,
      scriptId: job.scriptId,
      provider: aiMotionConfig().provider,
      meta: {
        generationMode: VideoGenerationMode.AI_MOTION,
        plannerVersion: AI_MOTION_PLANNER_VERSION,
      },
    });

    try {
      this.eligibility.assertEligible({
        workspace: job.workspace,
        scenes,
        targetDurationSeconds,
      });

      const plan = this.planner.plan({
        scenes,
        targetDurationSeconds,
        platform: job.publishTarget,
        offerName: job.offer?.name,
      });
      const estimate = this.estimator.estimate(plan);

      await this.persistPlan(job.id, plan, estimate);
      await this.maybeRunFakeProvider(job.id);

      this.logger.log({
        message: 'AiMotionPlanningCompleted',
        videoJobId: job.id,
        workspaceId: job.workspaceId,
        selectedScenes: plan.selectedScenes.length,
        plannerVersion: plan.planningVersion,
      });
      await this.monitoring.info({
        stage: 'RENDER',
        status: 'AiMotionPlanningCompleted',
        message: 'AI Motion planning completed',
        jobId: job.id,
        offerId: job.offerId,
        scriptId: job.scriptId,
        provider: aiMotionConfig().provider,
        meta: {
          plannedSceneCount: plan.selectedScenes.length,
          estimatedCredits: estimate.totalCredits,
          estimateFinal: estimate.isFinal,
          plannerVersion: plan.planningVersion,
        },
      });
      return { plan, estimate };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'AI Motion planning failed';
      await this.prisma.videoJob.update({
        where: { id: videoJobId },
        data: {
          motionPlanningStatus: MotionPlanningStatus.FAILED,
          error: message,
        },
      });
      await this.monitoring.warn({
        stage: 'RENDER',
        status: 'AiMotionPlanningFailed',
        message: 'AI Motion planning failed',
        jobId: videoJobId,
        offerId: job.offerId,
        scriptId: job.scriptId,
        provider: aiMotionConfig().provider,
        meta: { reason: message.slice(0, 160) },
      });
      throw error;
    }
  }

  private async persistPlan(
    videoJobId: string,
    plan: ReturnType<MotionScenePlannerService['plan']>,
    estimate: ReturnType<AiMotionCreditEstimatorService['estimate']>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      for (const selection of plan.selectedScenes) {
        const key = sceneAttemptKey({
          videoJobId,
          sceneIndex: selection.sceneIndex,
          plannerVersion: plan.planningVersion,
          attempt: 1,
        });
        await tx.videoJobMotionScene.upsert({
          where: { idempotencyKey: key },
          create: {
            videoJobId,
            sceneIndex: selection.sceneIndex,
            sourceSceneIndex: selection.sourceSceneIndex,
            idempotencyKey: key,
            plannerVersion: plan.planningVersion,
            motionEligible: true,
            motionSelected: true,
            selectionReason: selection.reason,
            plannedClipDuration: selection.plannedClipDuration,
            prompt: selection.prompt as unknown as Prisma.InputJsonValue,
            fallbackAssetUrl: selection.fallbackAssetUrl,
            generationStatus: 'PLANNED',
          },
          update: {
            motionEligible: true,
            motionSelected: true,
            selectionReason: selection.reason,
            plannedClipDuration: selection.plannedClipDuration,
            prompt: selection.prompt as unknown as Prisma.InputJsonValue,
            fallbackAssetUrl: selection.fallbackAssetUrl,
          },
        });
      }
      for (const rejection of plan.rejectedScenes) {
        const key = sceneAttemptKey({
          videoJobId,
          sceneIndex: rejection.sceneIndex,
          plannerVersion: plan.planningVersion,
          attempt: 1,
        });
        await tx.videoJobMotionScene.upsert({
          where: { idempotencyKey: key },
          create: {
            videoJobId,
            sceneIndex: rejection.sceneIndex,
            sourceSceneIndex: rejection.sourceSceneIndex,
            idempotencyKey: key,
            plannerVersion: plan.planningVersion,
            motionEligible: false,
            motionSelected: false,
            rejectionReason: rejection.reason,
            generationStatus: 'PLANNED',
          },
          update: {
            motionEligible: false,
            motionSelected: false,
            rejectionReason: rejection.reason,
          },
        });
      }
      await tx.videoJob.update({
        where: { id: videoJobId },
        data: {
          motionPlanningStatus: MotionPlanningStatus.PLANNED,
          plannedMotionSceneCount: plan.selectedScenes.length,
          estimatedMotionCredits: estimate.totalCredits,
          motionEstimateFinal: estimate.isFinal,
          motionPricingVersion: estimate.pricingVersion,
          motionEstimateCreatedAt: new Date(),
          motionFallbackPolicy: MotionFallbackPolicy.FALLBACK_TO_STANDARD,
          motionPlannerVersion: plan.planningVersion,
          fallbackMotionSceneCount: 0,
          completedMotionSceneCount: 0,
        },
      });
    });
  }

  private async maybeRunFakeProvider(videoJobId: string) {
    const config = aiMotionConfig();
    if (!config.fakeProviderEnabled) return;
    const scenes = await this.prisma.videoJobMotionScene.findMany({
      where: {
        videoJobId,
        motionSelected: true,
        generationStatus: { in: ['PLANNED', 'FAILED'] },
      },
      orderBy: { sceneIndex: 'asc' },
    });
    let completed = 0;
    let fallback = 0;
    for (const scene of scenes) {
      try {
        const result = await this.fakeProvider.createClip({
          idempotencyKey: scene.idempotencyKey,
          prompt: scene.prompt as never,
          fallbackAssetUrl: scene.fallbackAssetUrl,
        });
        await this.prisma.videoJobMotionScene.update({
          where: { id: scene.id },
          data: {
            provider: result.provider,
            providerJobId: result.providerJobId,
            motionClipUrl: result.clipUrl,
            assetType: result.clipUrl ? 'VIDEO' : 'IMAGE',
            generationStatus:
              result.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING',
          },
        });
        if (result.status === 'COMPLETED') completed += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Fake provider failed';
        await this.prisma.videoJobMotionScene.update({
          where: { id: scene.id },
          data: {
            generationStatus: 'FALLBACK_APPLIED',
            assetType: 'IMAGE',
            failureCode: 'FAKE_PROVIDER_FAILED',
            failureMessage: message.slice(0, 200),
          },
        });
        fallback += 1;
        await this.monitoring.warn({
          stage: 'RENDER',
          status: 'AiMotionSceneFallbackApplied',
          message: 'AI Motion scene fell back to Standard',
          jobId: videoJobId,
          provider: config.provider,
          meta: {
            sceneIndex: scene.sceneIndex,
            reasonCode: 'FAKE_PROVIDER_FAILED',
          },
        });
      }
    }
    if (completed || fallback) {
      await this.prisma.videoJob.update({
        where: { id: videoJobId },
        data: {
          completedMotionSceneCount: { increment: completed },
          fallbackMotionSceneCount: { increment: fallback },
        },
      });
    }
  }
}
