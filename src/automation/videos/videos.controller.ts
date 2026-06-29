/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { VideosService } from './videos.service';
import { ActiveWorkspace } from '../../workspaces/workspace.decorator';
import { WorkspaceGuard } from '../../workspaces/workspace.guard';
import { WorkspaceRoles } from '../../workspaces/workspace-roles.decorator';
import { ListVideosQueryDto } from './dto/list-videos-query.dto';
import { GenerateThumbnailDto } from '../dto/generate-thumbnail.dto';
import { ThumbnailService } from '../thumbnail.service';
import { CreateVideoJobDto } from './dto/create-video-job.dto';

@Controller('automation/videos')
@UseGuards(WorkspaceGuard)
@ApiTags('Videos')
@ApiBearerAuth('jwt')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly thumbnails: ThumbnailService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List workspace videos', description: 'Requires a valid workspace membership and x-workspace-id. Items include customer-safe status fields and trackingUrl when available.' })
  @ApiOkResponse({ description: 'Paginated videos.', schema: { example: { items: [{ id: 'f7e5f407-3dfb-43c7-87ef-8600cf2aa103', jobId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', videoUrl: 'https://cdn.example.com/video.mp4', published: true }], page: 1, limit: 20, total: 1 } } })
  list(@Query() query: ListVideosQueryDto, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.videosService.listVideos(query, workspace?.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer-safe video status', description: 'Requires a valid workspace membership and x-workspace-id.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  status(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.videosService.getVideoStatus(id, workspace?.id);
  }

  @Post(':scriptId')
  @UseGuards(ThrottlerGuard, WorkspaceGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Start video render for an approved workspace script', description: 'Requires a valid workspace membership, x-workspace-id, OWNER or ADMIN role, and an approved script in the active workspace.' })
  @ApiParam({ name: 'scriptId', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
  @ApiBody({ type: CreateVideoJobDto, required: false })
  @ApiOkResponse({ description: 'Customer-safe render start response.', schema: { example: { videoId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', scriptId: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', status: 'PROCESSING', renderStatus: 'PROCESSING', progress: 60, trackingUrl: null, message: 'Render started' } } })
  create(
    @Param('scriptId', ParseUUIDPipe) scriptId: string,
    @Body() body: CreateVideoJobDto = {},
    @ActiveWorkspace() workspace?: { id: string } | null,
  ) {
    return this.videosService.createCustomerVideo(scriptId, body, workspace?.id as string);
  }

  @Post(':id/publish')
  @UseGuards(ThrottlerGuard, WorkspaceGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @WorkspaceRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Queue a completed video for workspace YouTube publishing', description: 'Requires a valid workspace membership, x-workspace-id, a completed render, and a connected workspace YouTube channel.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  publish(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.videosService.publishVideo(id, workspace?.id);
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'Get video assets', description: 'Requires a valid workspace membership and x-workspace-id.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiOkResponse({ description: 'Assets for the video job.', schema: { example: { script: 'Script text...', imageUrls: ['https://cdn.example.com/image.jpg'], audioUrl: 'https://cdn.example.com/audio.mp3', videoUrl: 'https://cdn.example.com/video.mp4' } } })
  getAssets(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.videosService.getVideoAssets(id, workspace?.id);
  }

  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Get video job thumbnail metadata', description: 'Requires a valid workspace membership and x-workspace-id.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiOkResponse({ description: 'Video job thumbnail metadata.', schema: { example: { target: 'job', id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  getThumbnail(@Param('id', ParseUUIDPipe) id: string, @ActiveWorkspace() workspace?: { id: string } | null) {
    return this.thumbnails.getJobThumbnail(id, workspace?.id);
  }

  @Post(':id/thumbnail')
  @ApiOperation({ summary: 'Generate a video job thumbnail', description: 'Requires a valid workspace membership and x-workspace-id. Generates and uploads a social-safe thumbnail image. Does not upload to YouTube.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiBody({ type: GenerateThumbnailDto, required: false })
  @ApiOkResponse({ description: 'Generated thumbnail metadata.', schema: { example: { target: 'job', id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  generateThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateThumbnailDto,
    @ActiveWorkspace() workspace?: { id: string } | null,
  ) {
    return this.thumbnails.generateForJob(id, body?.prompt, workspace?.id);
  }

  @Patch(':id/thumbnail')
  @ApiOperation({ summary: 'Regenerate a video job thumbnail', description: 'Requires a valid workspace membership and x-workspace-id. Replaces thumbnail metadata with the latest generated image. Does not upload to YouTube.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiBody({ type: GenerateThumbnailDto, required: false })
  @ApiOkResponse({ description: 'Regenerated thumbnail metadata.', schema: { example: { target: 'job', id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  regenerateThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateThumbnailDto,
    @ActiveWorkspace() workspace?: { id: string } | null,
  ) {
    return this.thumbnails.generateForJob(id, body?.prompt, workspace?.id);
  }
}
