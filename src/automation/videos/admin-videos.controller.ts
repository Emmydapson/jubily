/* eslint-disable prettier/prettier */
import { Body, Controller, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AdminGuard } from '../../auth/admin.guard';
import { Roles } from '../../auth/roles.decorator';
import { VideosService } from './videos.service';
import { RegisterVideoDto } from './dto/register-video.dto';
import { CreateVideoJobDto } from './dto/create-video-job.dto';

@Controller('admin/manual-ops/videos')
@Roles('ADMIN')
@UseGuards(AdminGuard)
@ApiTags('Admin - Manual Ops')
@ApiBearerAuth('jwt')
export class AdminVideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiOperation({ summary: 'Register a rendered video', description: 'Admin-only endpoint for registering an already rendered video.' })
  @ApiBody({ type: RegisterVideoDto })
  @ApiOkResponse({ description: 'Registered video.' })
  register(@Body() dto: RegisterVideoDto) {
    return this.videosService.registerVideo(dto);
  }

  @Patch(':id/published')
  @UseGuards(ThrottlerGuard, AdminGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Mark a video job as published', description: 'Admin-only endpoint.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  markPublished(@Param('id', ParseUUIDPipe) id: string) {
    return this.videosService.markAsPublished(id);
  }

  @Patch(':id/failed')
  @ApiOperation({ summary: 'Mark a video job as failed', description: 'Admin-only endpoint.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  markFailed(@Param('id', ParseUUIDPipe) id: string) {
    return this.videosService.markAsFailed(id, 'Marked failed manually');
  }

  @Post(':scriptId/render')
  @UseGuards(ThrottlerGuard, AdminGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a video render job from an approved script', description: 'Admin-only endpoint.' })
  @ApiParam({ name: 'scriptId', format: 'uuid' })
  @ApiBody({ type: CreateVideoJobDto })
  createVideo(@Param('scriptId', ParseUUIDPipe) scriptId: string, @Body() body: CreateVideoJobDto) {
    const slot = body.slot ?? 'MORNING';
    const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : new Date();
    return this.videosService.createVideoJob(scriptId, body?.offerId, slot, scheduledFor);
  }
}
