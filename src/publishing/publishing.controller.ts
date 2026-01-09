import { Body, Controller, Post } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { CreatePublishResultDto } from './dto/create-publish-result.dto';

@Controller('automation/publish-result')
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  @Post()
  register(@Body() dto: CreatePublishResultDto) {
    return this.publishingService.registerResult(dto);
  }
}
