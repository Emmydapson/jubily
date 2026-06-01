/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { GoogleSheetsService } from '../common/google-sheets.service';
import { TopicIngestionService } from './topic-ingest.service';
import { Roles } from '../auth/roles.decorator';
import { GenerateScriptDto } from './dto/generate-script.dto';
import { GenerateAiScriptDto } from './dto/generate-ai-script.dto';
import { LogsQueryDto } from './dto/logs-query.dto';
import { UpdateScriptReviewStatusDto } from './dto/update-script-review-status.dto';
import { GenerateThumbnailDto } from './dto/generate-thumbnail.dto';
import { ThumbnailService } from './thumbnail.service';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

@Controller('automation')
@Roles('ADMIN')
@ApiTags('Automation')
@ApiBearerAuth('jwt')
export class AutomationController {
  constructor(private readonly automationService: AutomationService, 
    private readonly sheets: GoogleSheetsService,
     private readonly topicIngestion: TopicIngestionService,
     private readonly thumbnails: ThumbnailService,
  ) {}

  @Post('topics')
  @ApiOperation({ summary: 'Create a topic', description: 'Requires a valid ADMIN bearer token.' })
  @ApiBody({ type: CreateTopicDto })
  @ApiOkResponse({ description: 'Created topic.', schema: { example: { id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', title: 'Morning habits for more energy', source: 'manual', score: 80, used: false } } })
  createTopic(@Body() dto: CreateTopicDto) {
    return this.automationService.createTopic(dto);
  }

  @Post('scripts')
@ApiOperation({ summary: 'Create a script for a topic', description: 'Requires a valid ADMIN bearer token.' })
@ApiBody({ type: GenerateScriptDto })
@ApiOkResponse({ description: 'Created script.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', topicId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', content: 'Script content...' } } })
generateScript(@Body() body: GenerateScriptDto) {
  return this.automationService.generateScript(body);
}

@Post('scripts/ai')
@ApiOperation({ summary: 'Generate a script with AI', description: 'Requires a valid ADMIN bearer token.' })
@ApiBody({ type: GenerateAiScriptDto })
@ApiOkResponse({ description: 'Generated script.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', topicId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', content: 'AI-generated script content...' } } })
generateWithAi(@Body() body: GenerateAiScriptDto) {
  return this.automationService.generateScriptWithAi(body.topicId, body.topic);
}

@Get('topics')
@ApiOperation({ summary: 'List all topics', description: 'Requires a valid ADMIN bearer token.' })
@ApiOkResponse({ description: 'Topic list.', schema: { example: [{ id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', title: 'Morning habits for more energy', used: false, score: 80 }] } })
getTopics() {
  return this.automationService.getTopics();
}

@Get('topics/pending')
@ApiOperation({ summary: 'List pending topics', description: 'Requires a valid ADMIN bearer token.' })
@ApiOkResponse({ description: 'Pending topic list.', schema: { example: [{ id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', title: 'Morning habits for more energy', used: false }] } })
getPending() {
  return this.automationService.getPendingTopics();
}

@Patch('topics/:id/used')
@ApiOperation({ summary: 'Mark a topic as used', description: 'Requires a valid ADMIN bearer token.' })
@ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
@ApiOkResponse({ description: 'Updated topic.', schema: { example: { id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', used: true } } })
markUsed(@Param('id', ParseUUIDPipe) id: string) {
  return this.automationService.markTopicUsed(id);
}

@Get('scripts')
@ApiOperation({ summary: 'List scripts', description: 'Requires a valid ADMIN bearer token.' })
@ApiOkResponse({ description: 'Script list.', schema: { example: [{ id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', topicId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', content: 'Script content...' }] } })
getAllScripts() {
  return this.automationService.getAllScripts();
}

@Get('scripts/:id')
  @ApiOperation({ summary: 'Get a script by ID', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiOkResponse({ description: 'Script details.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', topicId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', content: 'Script content...' } } })
  getScriptById(@Param('id', ParseUUIDPipe) id: string) {
    return this.automationService.getScriptById(id);
  }

@Get('scripts/:id/quality')
  @ApiOperation({ summary: 'Get script quality metadata', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiOkResponse({ description: 'Script quality metadata.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', reviewStatus: 'NEEDS_REVIEW', qualityScore: 72, selectedTitle: 'Simple hydration mistakes people make' } } })
  getScriptQuality(@Param('id', ParseUUIDPipe) id: string) {
    return this.automationService.getScriptQualityMetadata(id);
  }

  @Patch('scripts/:id/review-status')
  @ApiOperation({ summary: 'Approve or reject a script review status', description: 'Requires a valid ADMIN bearer token. APPROVED is the manual override that allows render and publish.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiBody({ type: UpdateScriptReviewStatusDto })
  @ApiOkResponse({ description: 'Updated script review metadata.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', reviewStatus: 'APPROVED', qualityScore: 72 } } })
  updateScriptReviewStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateScriptReviewStatusDto,
  ) {
    return this.automationService.updateScriptReviewStatus(
      id,
      body.reviewStatus ?? 'APPROVED',
      body.note,
    );
  }

  @Post('scripts/:id/review')
  @ApiOperation({ summary: 'Regenerate quality metadata for a script', description: 'Requires a valid ADMIN bearer token. Re-runs content quality review and rewrite attempts; thumbnail image generation is not performed.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiOkResponse({ description: 'Updated script quality metadata.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', reviewStatus: 'APPROVED', qualityScore: 84 } } })
  reReviewScript(@Param('id', ParseUUIDPipe) id: string) {
    return this.automationService.reReviewScript(id);
  }

  @Get('scripts/:id/thumbnail')
  @ApiOperation({ summary: 'Get script thumbnail metadata', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiOkResponse({ description: 'Script thumbnail metadata.', schema: { example: { target: 'script', id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  getScriptThumbnail(@Param('id', ParseUUIDPipe) id: string) {
    return this.thumbnails.getScriptThumbnail(id);
  }

  @Post('scripts/:id/thumbnail')
  @ApiOperation({ summary: 'Generate a script thumbnail', description: 'Requires a valid ADMIN bearer token. Generates and uploads a social-safe thumbnail image. Does not upload to YouTube.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiBody({ type: GenerateThumbnailDto, required: false })
  @ApiOkResponse({ description: 'Generated thumbnail metadata.', schema: { example: { target: 'script', id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  generateScriptThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateThumbnailDto,
  ) {
    return this.thumbnails.generateForScript(id, body?.prompt);
  }

  @Patch('scripts/:id/thumbnail')
  @ApiOperation({ summary: 'Regenerate a script thumbnail', description: 'Requires a valid ADMIN bearer token. Replaces thumbnail metadata with the latest generated image. Does not upload to YouTube.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiBody({ type: GenerateThumbnailDto, required: false })
  @ApiOkResponse({ description: 'Regenerated thumbnail metadata.', schema: { example: { target: 'script', id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  regenerateScriptThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateThumbnailDto,
  ) {
    return this.thumbnails.generateForScript(id, body?.prompt);
  }

  @Get('logs')
  @ApiOperation({ summary: 'List automation logs', description: 'Requires a valid ADMIN bearer token.' })
  @ApiOkResponse({ description: 'Automation log rows.', schema: { example: { items: [{ jobId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', scriptId: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', topicTitle: 'Morning habits for more energy', offerName: 'Wellness Offer', platform: 'youtube', status: 'COMPLETED', url: 'https://youtu.be/example', error: null, createdAt: '2026-05-30T14:00:00.000Z', loggedAt: '2026-05-30T14:10:00.000Z' }] } } })
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

@Post('ingest')
@ApiOperation({ summary: 'Ingest topics now', description: 'Requires a valid ADMIN bearer token.' })
@ApiOkResponse({ description: 'Pending topic pool result.', schema: { example: { ok: true, created: 12 } } })
async ingestNow() {
  return this.topicIngestion.ensurePendingPool();
}

@Post('topics/seed')
@ApiOperation({ summary: 'Seed default topics', description: 'Requires a valid ADMIN bearer token.' })
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
