/* eslint-disable prettier/prettier */
import { Controller, Get } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { Roles } from '../auth/roles.decorator';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('automation/workflow')
@Roles('ADMIN')
@ApiTags('Workflow')
@ApiBearerAuth('jwt')
export class WorkflowController {
  constructor(private workflow: WorkflowService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get workflow status', description: 'Requires a valid ADMIN bearer token.' })
  @ApiOkResponse({ description: 'Workflow status snapshot.', schema: { example: { automationEnabled: true, pendingTopics: 12, runningJobs: 1, nextRunAt: '2026-05-30T18:00:00.000Z' } } })
  status() {
    return this.workflow.getStatus();
  }
}
