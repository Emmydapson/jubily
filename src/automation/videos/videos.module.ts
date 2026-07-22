/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { AdminVideosController } from './admin-videos.controller';
import { ShotstackService } from './shotstack.service';
import { RenderWorker } from './render.worker';
import { PublishWorker } from './publish.worker';
import { GoogleSheetsService } from '../../common/google-sheets.service';
import { YoutubeService } from '../../common/youtube.service';
import { ShotstackServeService } from './shotstack-serve.service';
import { GoogleTtsService } from '../tts/google-tts.service';
import { AiImageService } from '../ai/ai-image.service';
import { MonitoringModule } from 'src/monitoring/monitoring.module';
import { SettingsModule } from 'src/settings/settings.module';
import { ThumbnailService } from '../thumbnail.service';
import { WorkspacesModule } from '../../workspaces/workspaces.module';
import { BillingModule } from '../../billing/billing.module';
import { AuditModule } from '../../audit/audit.module';
import { AdminGuard } from '../../auth/admin.guard';
import { PublishingModule } from '../../publishing/publishing.module';
import { AiMotionEligibilityService } from './ai-motion-eligibility.service';
import { MotionPromptBuilder } from './motion-prompt.builder';
import { MotionScenePlannerService } from './motion-scene-planner.service';
import { AiMotionCreditEstimatorService } from './ai-motion-credit-estimator.service';
import { FakeAiMotionProvider } from './fake-ai-motion.provider';
import { AiMotionOrchestratorService } from './ai-motion-orchestrator.service';

@Module({
  providers: [
    VideosService,
    ShotstackService,
    ShotstackServeService,
    RenderWorker,
    PublishWorker, // ✅ add
    GoogleSheetsService,
    YoutubeService, // ✅ add
    GoogleTtsService,
    AiImageService,
    ThumbnailService,
    AdminGuard,
    AiMotionEligibilityService,
    MotionPromptBuilder,
    MotionScenePlannerService,
    AiMotionCreditEstimatorService,
    FakeAiMotionProvider,
    AiMotionOrchestratorService,
  ],
  controllers: [VideosController, AdminVideosController],
  exports: [VideosService, YoutubeService],
  imports: [
    MonitoringModule,
    SettingsModule,
    WorkspacesModule,
    BillingModule,
    AuditModule,
    PublishingModule,
  ],
})
export class VideosModule {}
