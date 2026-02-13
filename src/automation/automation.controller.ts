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
      jobId: String(r[0] ?? ''),
      scriptId: String(r[1] ?? ''),
      topicTitle: String(r[2] ?? ''),
      offerName: String(r[3] ?? ''),
      platform: String(r[4] ?? ''),
      status: String(r[5] ?? ''),
      url: String(r[6] ?? ''),
      error: String(r[7] ?? ''),
      createdAt: String(r[8] ?? ''),
      loggedAt: String(r[9] ?? ''),
    }));

    return { items };
  }

}
