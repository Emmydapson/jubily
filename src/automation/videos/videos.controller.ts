/* eslint-disable prettier/prettier */
import { Body, Controller, Post, Patch, Param, Get, Query } from '@nestjs/common';
import { VideosService } from './videos.service';
import { RegisterVideoDto } from './dto/register-video.dto';

@Controller('automation/videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  async register(@Body() dto: RegisterVideoDto) {
    return this.videosService.registerVideo(dto);
  }

  @Patch(':id/published')
  async markPublished(@Param('id') id: string) {
    return this.videosService.markAsPublished(id);
  }

  @Patch(':id/failed')
  async markFailed(@Param('id') id: string) {
    return this.videosService.markAsFailed(id);
  }

  // 🚀 Trigger new video render job
  @Post(':scriptId')
createVideo(
  @Param('scriptId') scriptId: string,
  @Body() body: { offerId?: string; slot?: 'MORNING' | 'AFTERNOON' | 'EVENING'; scheduledFor?: string },
) {
  const slot = body.slot ?? 'MORNING';
  const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : new Date();
  return this.videosService.createVideoJob(scriptId, body?.offerId, slot, scheduledFor);
}

  @Get()
   list(@Query() query: any) {
    return this.videosService.listVideos(query);
  }

  @Get(':id/assets')
  getAssets(@Param('id') id: string) {
    return this.videosService.getVideoAssets(id);
  }
}
