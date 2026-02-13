/* eslint-disable prettier/prettier */
import { Controller, Get } from '@nestjs/common';
import { WorkflowService } from './workflow.service';

@Controller('automation/workflow')
export class WorkflowController {
  constructor(private workflow: WorkflowService) {}

  @Get('status')
  status() {
    return this.workflow.getStatus();
  }
}
