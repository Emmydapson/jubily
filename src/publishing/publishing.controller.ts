import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { CreatePublishResultDto } from './dto/create-publish-result.dto';
import { Roles } from '../auth/roles.decorator';
import { AdminGuard } from '../auth/admin.guard';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@Controller('admin/manual-ops/publish-result')
@Roles('ADMIN')
@UseGuards(AdminGuard)
@ApiTags('Admin - Publishing')
@ApiBearerAuth('jwt')
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  @Post()
  @ApiOperation({
    summary: 'Register a publish result',
    description: 'Admin-only endpoint.',
  })
  @ApiBody({ type: CreatePublishResultDto })
  @ApiOkResponse({
    description: 'Registered publish result.',
    schema: {
      example: {
        id: 'c2974e9c-cb57-49d5-932e-580897250f98',
        platform: 'youtube',
        platformPostId: 'dQw4w9WgXcQ',
        status: 'SUCCESS',
      },
    },
  })
  register(@Body() dto: CreatePublishResultDto) {
    return this.publishingService.registerResult(dto);
  }
}
