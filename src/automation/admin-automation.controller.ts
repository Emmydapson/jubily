/* eslint-disable prettier/prettier */
import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../auth/admin.guard';
import { Roles } from '../auth/roles.decorator';
import { GoogleSheetsService } from '../common/google-sheets.service';
import { TopicIngestionService } from './topic-ingest.service';
import { AutomationService } from './automation.service';
import { LogsQueryDto } from './dto/logs-query.dto';

@Controller()
@Roles('ADMIN')
@UseGuards(AdminGuard)
@ApiBearerAuth('jwt')
export class AdminAutomationController {
  constructor(
    private readonly sheets: GoogleSheetsService,
    private readonly topicIngestion: TopicIngestionService,
    private readonly automationService: AutomationService,
  ) {}

  @Get('admin/logs/automation')
  @ApiTags('Admin - Logs')
  @ApiOperation({ summary: 'List automation logs', description: 'Admin-only endpoint.' })
  @ApiOkResponse({ description: 'Automation log rows.' })
  async getLogs(@Query() query: LogsQueryDto) {
    const take = query.limit ?? 20;
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

  @Post('admin/manual-ops/ingest')
  @ApiTags('Admin - Manual Ops')
  @ApiOperation({ summary: 'Ingest topics now', description: 'Admin-only endpoint.' })
  @ApiOkResponse({ description: 'Pending topic pool result.', schema: { example: { ok: true, created: 12 } } })
  ingestNow() {
    return this.topicIngestion.ensurePendingPool();
  }

  @Post('admin/manual-ops/topics/seed')
  @ApiTags('Admin - Manual Ops')
  @ApiOperation({ summary: 'Seed default topics', description: 'Admin-only endpoint.' })
  @ApiOkResponse({ description: 'Seed result.', schema: { example: { ok: true, created: 20 } } })
  async seedTopics() {
    const topics = [
      'How to compare affiliate products before buying',
      'Best AI tools beginners overlook',
      'Common mistakes when choosing finance apps',
      'What to check before buying a course',
      'Why product demos convert on YouTube',
      'How to spot useful ecommerce deals',
      'Best software features to compare first',
      'How to pick travel gear without overpaying',
      'Beginner gaming accessories worth comparing',
      'What small businesses need before choosing tools',
      'How to review Amazon products fairly',
      'Best productivity tools for remote workers',
      'How to explain affiliate offers without hype',
      'What buyers should know before subscribing',
      'How to compare beauty products online',
      'Best home office products for creators',
      'How to evaluate real estate lead tools',
      'What parents should compare before buying',
      'How to choose pet products online',
      'Best affiliate link CTA for YouTube Shorts',
    ];

    let created = 0;
    for (const title of topics) {
      const exists = await this.automationService.createTopic({ title, source: 'seed', score: 80 });
      if (exists) created++;
    }

    return { ok: true, created };
  }
}
