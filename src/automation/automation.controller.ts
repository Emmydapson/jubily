/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { GoogleSheetsService } from '../common/google-sheets.service';

@Controller('automation')
export class AutomationController {
  constructor(private readonly automationService: AutomationService, 
    private readonly sheets: GoogleSheetsService,
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
}
