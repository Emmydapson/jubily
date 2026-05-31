import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Roles } from './auth/roles.decorator';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@Controller()
@Roles('ADMIN')
@ApiTags('App')
@ApiBearerAuth('jwt')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Health greeting',
    description: 'Requires a valid ADMIN bearer token.',
  })
  @ApiOkResponse({
    description: 'Service greeting.',
    schema: { example: 'Hello World!' },
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
