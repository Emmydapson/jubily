import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { Roles } from './auth/roles.decorator';
import { AdminGuard } from './auth/admin.guard';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@Controller('admin/platform')
@Roles('ADMIN')
@UseGuards(AdminGuard)
@ApiTags('Admin - Platform')
@ApiBearerAuth('jwt')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOperation({
    summary: 'Health greeting',
    description: 'Admin-only endpoint.',
  })
  @ApiOkResponse({
    description: 'Service greeting.',
    schema: { example: 'Hello World!' },
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
