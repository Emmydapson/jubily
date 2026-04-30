/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { ScriptService } from './script.service';
import { VideosModule } from './videos/videos.module';
import { AiService } from './ai/ai.service';
import { AutomationCron } from './automation.cron';
import { OrchestratorService } from './orchestrator.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { SettingsModule } from 'src/settings/settings.module';
import { GoogleSheetsService } from 'src/common/google-sheets.service';
import { OrchestratorController } from './orchestrator.controller';

import { JobsController } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { AiImageService } from './ai/ai-image.service';
import { TopicIngestionService } from './topic-ingest.service';
import { MonitoringModule } from 'src/monitoring/monitoring.module';

@Module({
  controllers: [
    AutomationController,
    WorkflowController,
    AnalyticsController,
    OrchestratorController,
    JobsController,
  ],
  providers: [
    AutomationService,
    ScriptService,
    AiService,
    OrchestratorService,
    AutomationCron,
    WorkflowService,
    AnalyticsService,
    GoogleSheetsService,
    JobsService,
    AiImageService,
    TopicIngestionService
  ],
  imports: [VideosModule, SettingsModule, MonitoringModule],
})
export class AutomationModule {}
