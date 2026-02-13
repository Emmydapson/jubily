/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Controller('automation/jobs')
export class JobsController {
  constructor(private jobs: JobsService) {}

  @Get()
  list(@Query() query: any) {
    return this.jobs.list(query);
  }

  @Get('summary')
  summary() {
    return this.jobs.failedSummary();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.jobs.getOne(id);
  }

  @Get(':id/assets')
  assets(@Param('id') id: string) {
    return this.jobs.getJobAssets(id);
  }

  // optional: manual run slot
  @Post('run-slot')
  runSlot(@Body() body: { slot: 'MORNING' | 'AFTERNOON' | 'EVENING' }) {
    return this.jobs.runSlot(body.slot);
  }

  // optional: retry
  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.jobs.retryJob(id);
  }
}
