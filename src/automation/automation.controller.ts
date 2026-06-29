/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { ActiveWorkspace } from '../workspaces/workspace.decorator';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { WorkspaceRoles } from '../workspaces/workspace-roles.decorator';
import { GenerateScriptDto } from './dto/generate-script.dto';
import { GenerateAiScriptDto } from './dto/generate-ai-script.dto';
import { GenerateAiFromOfferDto } from './dto/generate-ai-from-offer.dto';
import { UpdateScriptReviewStatusDto } from './dto/update-script-review-status.dto';
import { UpdateScriptDto } from './dto/update-script.dto';
import { GenerateThumbnailDto } from './dto/generate-thumbnail.dto';
import { ThumbnailService } from './thumbnail.service';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

@Controller('automation')
@UseGuards(WorkspaceGuard)
@ApiTags('Automation')
@ApiBearerAuth('jwt')
export class AutomationController {
  constructor(private readonly automationService: AutomationService, 
     private readonly thumbnails: ThumbnailService,
  ) {}

  @Post('topics')
  @ApiOperation({ summary: 'Create a workspace topic', description: 'Requires a valid workspace membership and x-workspace-id.' })
  @ApiBody({ type: CreateTopicDto })
  @ApiOkResponse({ description: 'Created topic.', schema: { example: { id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', title: 'Morning habits for more energy', source: 'manual', score: 80, used: false } } })
  createTopic(@Body() dto: CreateTopicDto, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.automationService.createTopic(dto, workspace?.id);
  }

  @Post('scripts')
@ApiOperation({ summary: 'Create a script for a topic', description: 'Requires a valid workspace membership and x-workspace-id.' })
@ApiBody({ type: GenerateScriptDto })
@ApiOkResponse({ description: 'Created script.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', topicId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', content: 'Script content...' } } })
generateScript(@Body() body: GenerateScriptDto, @ActiveWorkspace() workspace?: { id: string } | null) {
  return this.automationService.generateScript(body, workspace?.id);
}

@Post('scripts/ai')
@UseGuards(ThrottlerGuard, WorkspaceGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@ApiOperation({ summary: 'Generate a script with AI', description: 'Requires a valid workspace membership and x-workspace-id.' })
@ApiBody({ type: GenerateAiScriptDto })
@ApiOkResponse({ description: 'Generated script.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', topicId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', content: 'AI-generated script content...' } } })
generateWithAi(@Body() body: GenerateAiScriptDto, @ActiveWorkspace() workspace?: { id: string } | null) {
  return this.automationService.generateScriptWithAi(body.topicId, body.topic, workspace?.id);
}

@Post('scripts/ai-from-offer')
@UseGuards(ThrottlerGuard, WorkspaceGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@ApiOperation({ summary: 'Generate a product-aware script with AI', description: 'Requires a valid workspace membership and x-workspace-id. The offer must belong to the active workspace.' })
@ApiBody({ type: GenerateAiFromOfferDto })
generateWithAiFromOffer(@Body() body: GenerateAiFromOfferDto, @ActiveWorkspace() workspace?: { id: string } | null) {
  return this.automationService.generateScriptWithAiFromOffer(body, workspace?.id);
}

@Get('topics')
@ApiOperation({ summary: 'List workspace topics', description: 'Requires a valid workspace membership and x-workspace-id.' })
@ApiOkResponse({ description: 'Topic list.', schema: { example: [{ id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', title: 'Morning habits for more energy', used: false, score: 80 }] } })
getTopics(@ActiveWorkspace() workspace?: { id: string } | null) {
  return this.automationService.getTopics(workspace?.id);
}

@Get('topics/pending')
@ApiOperation({ summary: 'List pending workspace topics', description: 'Requires a valid workspace membership and x-workspace-id.' })
@ApiOkResponse({ description: 'Pending topic list.', schema: { example: [{ id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', title: 'Morning habits for more energy', used: false }] } })
getPending(@ActiveWorkspace() workspace?: { id: string } | null) {
  return this.automationService.getPendingTopics(workspace?.id);
}

@Patch('topics/:id/used')
@ApiOperation({ summary: 'Mark a topic as used', description: 'Requires a valid workspace membership and x-workspace-id.' })
@ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
@ApiOkResponse({ description: 'Updated topic.', schema: { example: { id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', used: true } } })
markUsed(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
  return this.automationService.markTopicUsed(id, workspace?.id);
}

@Get('scripts')
@ApiOperation({ summary: 'List workspace scripts', description: 'Requires a valid workspace membership and x-workspace-id.' })
@ApiOkResponse({ description: 'Script list.', schema: { example: [{ id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', topicId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', content: 'Script content...' }] } })
getAllScripts(@ActiveWorkspace() workspace?: { id: string } | null) {
  return this.automationService.getAllScripts(workspace?.id);
}

@Get('scripts/:id')
  @ApiOperation({ summary: 'Get a script by ID', description: 'Requires a valid workspace membership and x-workspace-id.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiOkResponse({ description: 'Script details.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', topicId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', content: 'Script content...' } } })
  getScriptById(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.automationService.getScriptById(id, workspace?.id);
  }

@Get('scripts/:id/quality')
  @ApiOperation({ summary: 'Get script quality metadata', description: 'Requires a valid workspace membership and x-workspace-id.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiOkResponse({ description: 'Script quality metadata.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', reviewStatus: 'NEEDS_REVIEW', qualityScore: 72, selectedTitle: 'Simple hydration mistakes people make' } } })
  getScriptQuality(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.automationService.getScriptQualityMetadata(id, workspace?.id);
  }

  @Patch('scripts/:id')
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Edit script content and publish metadata', description: 'Requires a valid workspace membership and x-workspace-id.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiBody({ type: UpdateScriptDto })
  updateScript(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateScriptDto,
    @ActiveWorkspace() workspace?: { id: string } | null,
  ) {
    return this.automationService.updateScript(id, body, workspace?.id);
  }

  @Patch('scripts/:id/review-status')
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Approve or reject a script review status', description: 'Requires a valid workspace membership and x-workspace-id. APPROVED allows render and publish.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiBody({ type: UpdateScriptReviewStatusDto })
  @ApiOkResponse({ description: 'Updated script review metadata.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', reviewStatus: 'APPROVED', qualityScore: 72 } } })
  updateScriptReviewStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateScriptReviewStatusDto,
    @ActiveWorkspace() workspace?: { id: string } | null,
  ) {
    return this.automationService.updateScriptReviewStatus(
      id,
      body.reviewStatus ?? 'APPROVED',
      body.note,
      workspace?.id,
    );
  }

  @Post('scripts/:id/review')
  @UseGuards(ThrottlerGuard, WorkspaceGuard)
  @WorkspaceRoles('OWNER', 'ADMIN')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Regenerate quality metadata for a script', description: 'Requires a workspace OWNER or ADMIN membership. Re-runs content quality review and rewrite attempts; thumbnail image generation is not performed.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiOkResponse({ description: 'Updated script quality metadata.', schema: { example: { id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', reviewStatus: 'APPROVED', qualityScore: 84 } } })
  reReviewScript(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.automationService.reReviewScript(id, workspace?.id);
  }

  @Get('scripts/:id/thumbnail')
  @ApiOperation({ summary: 'Get script thumbnail metadata', description: 'Requires a valid workspace membership and x-workspace-id.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiOkResponse({ description: 'Script thumbnail metadata.', schema: { example: { target: 'script', id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  getScriptThumbnail(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.thumbnails.getScriptThumbnail(id, workspace?.id);
  }

  @Post('scripts/:id/thumbnail')
  @ApiOperation({ summary: 'Generate a script thumbnail', description: 'Requires a valid workspace membership and x-workspace-id. Generates and uploads a social-safe thumbnail image. Does not upload to YouTube.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiBody({ type: GenerateThumbnailDto, required: false })
  @ApiOkResponse({ description: 'Generated thumbnail metadata.', schema: { example: { target: 'script', id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  generateScriptThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateThumbnailDto,
    @ActiveWorkspace() workspace?: { id: string } | null,
  ) {
    return this.thumbnails.generateForScript(id, body?.prompt, workspace?.id);
  }

  @Patch('scripts/:id/thumbnail')
  @ApiOperation({ summary: 'Regenerate a script thumbnail', description: 'Requires a valid workspace membership and x-workspace-id. Replaces thumbnail metadata with the latest generated image. Does not upload to YouTube.' })
  @ApiParam({ name: 'id', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiBody({ type: GenerateThumbnailDto, required: false })
  @ApiOkResponse({ description: 'Regenerated thumbnail metadata.', schema: { example: { target: 'script', id: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  regenerateScriptThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateThumbnailDto,
    @ActiveWorkspace() workspace?: { id: string } | null,
  ) {
    return this.thumbnails.generateForScript(id, body?.prompt, workspace?.id);
  }

}
