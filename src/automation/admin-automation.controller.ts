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
      const exists = await this.automationService.createTopic({ title, source: 'seed', score: 80 });
      if (exists) created++;
    }

    return { ok: true, created };
  }
}
