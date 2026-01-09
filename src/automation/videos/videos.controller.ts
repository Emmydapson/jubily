import { Body, Controller, Post, Patch, Param } from '@nestjs/common';
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
}
