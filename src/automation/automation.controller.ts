/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { GoogleSheetsService } from '../common/google-sheets.service';
import { TopicIngestionService } from './topic-ingest.service';

@Controller('automation')
export class AutomationController {
  constructor(private readonly automationService: AutomationService, 
    private readonly sheets: GoogleSheetsService,
     private readonly topicIngestion: TopicIngestionService,
  ) {}

  @Post('topics')
  createTopic(@Body() dto: CreateTopicDto) {
    return this.automationService.createTopic(dto);
  }

  @Post('scripts')
generateScript(@Body() body: { topicId: string; content: string }) {
  return this.automationService.generateScript(body);

  
}

@Post('scripts/ai')
generateWithAi(@Body() body: { topicId: string; topic: string }) {
  return this.automationService.generateScriptWithAi(body.topicId, body.topic);
}

@Get('topics')
getTopics() {
  return this.automationService.getTopics();
}

@Get('topics/pending')
getPending() {
  return this.automationService.getPendingTopics();
}

@Patch('topics/:id/used')
markUsed(@Param('id') id: string) {
  return this.automationService.markTopicUsed(id);
}

@Get('scripts')
getAllScripts() {
  return this.automationService.getAllScripts();
}

@Get('scripts/:id')
  getScriptById(@Param('id') id: string) {
    return this.automationService.getScriptById(id);
  }

  @Get('logs')
async getLogs(@Query('limit') limit?: string) {
  const take = Math.min(Math.max(Number(limit ?? 20), 1), 200);

  const rows = await this.sheets.getAutomationLogs(take);

  const items = rows.map((r) => ({
    jobId: r.jobId,
    scriptId: r.scriptId,
    topicTitle: r.topicTitle,
    offerName: r.product,
    platform: r.platform,
    status: r.status,
    url: r.url,
    error: r.note,
    createdAt: r.createdAt,
    loggedAt: r.updatedAt,
  }));

  return { items };
}

@Get('analytics/weekly')
async getWeeklyAnalytics(@Query('days') days?: string) {
  const take = Math.min(Math.max(Number(days ?? 7), 1), 30);
  return this.sheets.getWeeklyAnalytics(take);
}

@Post('ingest')
async ingestNow() {
  return this.topicIngestion.ensurePendingPool();
}

@Post('topics/seed')
async seedTopics() {
  const topics = [
    'Morning habits for more energy',
    'How sleep improves mental clarity',
    'Simple hydration mistakes people make',
    'Quick ways to reduce stress naturally',
    'Foods that boost brain performance',
    'Why walking daily changes your health',
    'Signs your body needs more water',
    'Best morning routine for productivity',
    'How to improve focus without caffeine',
    'Why your energy crashes in the afternoon',
    'Easy weight loss habits that actually work',
    'How breathing affects anxiety levels',
    'The truth about sugar and fatigue',
    'Why consistent sleep matters more than you think',
    'Simple exercises for busy people',
    'How to build discipline with small habits',
    'Foods that improve gut health',
    'Why your mood depends on sleep quality',
    'Small daily habits that change your life',
    'How to stay healthy while working long hours',
  ];

  let created = 0;

  for (const title of topics) {
    const exists = await this.automationService.createTopic({
      title,
      source: 'seed',
      score: 80,
    });

    if (exists) created++;
  }

  return { ok: true, created };
}
}
