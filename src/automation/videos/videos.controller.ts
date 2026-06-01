/* eslint-disable prettier/prettier */
import { Body, Controller, Post, Patch, Param, Get, Query, ParseUUIDPipe } from '@nestjs/common';
import { VideosService } from './videos.service';
import { RegisterVideoDto } from './dto/register-video.dto';
import { Roles } from '../../auth/roles.decorator';
import { CreateVideoJobDto } from './dto/create-video-job.dto';
import { ListVideosQueryDto } from './dto/list-videos-query.dto';
import { GenerateThumbnailDto } from '../dto/generate-thumbnail.dto';
import { ThumbnailService } from '../thumbnail.service';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

@Controller('automation/videos')
@Roles('ADMIN')
@ApiTags('Videos')
@ApiBearerAuth('jwt')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly thumbnails: ThumbnailService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Register a rendered video', description: 'Requires a valid ADMIN bearer token.' })
  @ApiBody({ type: RegisterVideoDto })
  @ApiOkResponse({ description: 'Registered video.', schema: { example: { id: 'f7e5f407-3dfb-43c7-87ef-8600cf2aa103', jobId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', videoUrl: 'https://cdn.example.com/video.mp4', published: false } } })
  async register(@Body() dto: RegisterVideoDto) {
    return this.videosService.registerVideo(dto);
  }

  @Patch(':id/published')
  @ApiOperation({ summary: 'Mark a video job as published', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiOkResponse({ description: 'Updated video job.', schema: { example: { id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', published: true, status: 'COMPLETED' } } })
  async markPublished(@Param('id', ParseUUIDPipe) id: string) {
    return this.videosService.markAsPublished(id);
  }

  @Patch(':id/failed')
  @ApiOperation({ summary: 'Mark a video job as failed', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiOkResponse({ description: 'Updated video job.', schema: { example: { id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', status: 'FAILED' } } })
  async markFailed(@Param('id', ParseUUIDPipe) id: string) {
    return this.videosService.markAsFailed(id);
  }

  // 🚀 Trigger new video render job
  @Post(':scriptId')
@ApiOperation({ summary: 'Create a video render job from a script', description: 'Requires a valid ADMIN bearer token.' })
@ApiParam({ name: 'scriptId', format: 'uuid', example: 'b6efa6b9-6113-40ab-97ac-f461356c4c70' })
@ApiBody({ type: CreateVideoJobDto })
@ApiOkResponse({ description: 'Created video job.', schema: { example: { id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', scriptId: 'b6efa6b9-6113-40ab-97ac-f461356c4c70', status: 'PENDING', slot: 'MORNING' } } })
createVideo(
  @Param('scriptId', ParseUUIDPipe) scriptId: string,
  @Body() body: CreateVideoJobDto,
) {
  const slot = body.slot ?? 'MORNING';
  const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : new Date();
  return this.videosService.createVideoJob(scriptId, body?.offerId, slot, scheduledFor);
}

  @Get()
   @ApiOperation({ summary: 'List videos', description: 'Requires a valid ADMIN bearer token.' })
   @ApiOkResponse({ description: 'Paginated videos.', schema: { example: { items: [{ id: 'f7e5f407-3dfb-43c7-87ef-8600cf2aa103', jobId: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', videoUrl: 'https://cdn.example.com/video.mp4', published: true }], page: 1, limit: 20, total: 1 } } })
   list(@Query() query: ListVideosQueryDto) {
    return this.videosService.listVideos(query);
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'Get video assets', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiOkResponse({ description: 'Assets for the video job.', schema: { example: { script: 'Script text...', imageUrls: ['https://cdn.example.com/image.jpg'], audioUrl: 'https://cdn.example.com/audio.mp3', videoUrl: 'https://cdn.example.com/video.mp4' } } })
  getAssets(@Param('id', ParseUUIDPipe) id: string) {
    return this.videosService.getVideoAssets(id);
  }

  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Get video job thumbnail metadata', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiOkResponse({ description: 'Video job thumbnail metadata.', schema: { example: { target: 'job', id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  getThumbnail(@Param('id', ParseUUIDPipe) id: string) {
    return this.thumbnails.getJobThumbnail(id);
  }

  @Post(':id/thumbnail')
  @ApiOperation({ summary: 'Generate a video job thumbnail', description: 'Requires a valid ADMIN bearer token. Generates and uploads a social-safe thumbnail image. Does not upload to YouTube.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiBody({ type: GenerateThumbnailDto, required: false })
  @ApiOkResponse({ description: 'Generated thumbnail metadata.', schema: { example: { target: 'job', id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  generateThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateThumbnailDto,
  ) {
    return this.thumbnails.generateForJob(id, body?.prompt);
  }

  @Patch(':id/thumbnail')
  @ApiOperation({ summary: 'Regenerate a video job thumbnail', description: 'Requires a valid ADMIN bearer token. Replaces thumbnail metadata with the latest generated image. Does not upload to YouTube.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiBody({ type: GenerateThumbnailDto, required: false })
  @ApiOkResponse({ description: 'Regenerated thumbnail metadata.', schema: { example: { target: 'job', id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', thumbnailStatus: 'READY', thumbnailImageUrl: 'https://res.cloudinary.com/example/image/upload/thumbnail.jpg' } } })
  regenerateThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateThumbnailDto,
  ) {
    return this.thumbnails.generateForJob(id, body?.prompt);
  }
}
