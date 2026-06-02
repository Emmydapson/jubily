/* eslint-disable prettier/prettier */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { Roles } from '../../auth/roles.decorator';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { RunSlotDto } from '../run-slot.dto';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CancelJobDto } from './dto/cancel-job.dto';
import { VideoJobStatus } from '../video-job-status';

@Controller('automation/jobs')
@Roles('ADMIN')
@ApiTags('Jobs')
@ApiBearerAuth('jwt')
export class JobsController {
  constructor(private jobs: JobsService) {}

  @Get()
  @ApiOperation({ summary: 'List video jobs', description: 'Requires a valid ADMIN bearer token.' })
  @ApiOkResponse({ description: 'Paginated video jobs.', schema: { example: { items: [{ id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', status: 'PENDING', slot: 'MORNING', published: false }], page: 1, limit: 20, total: 1 } } })
  list(@Query() query: ListJobsQueryDto) {
    return this.jobs.list(query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get failed job summary', description: 'Requires a valid ADMIN bearer token.' })
  @ApiOkResponse({ description: 'Failure summary.', schema: { example: { failed: 2, failedPermanent: 1, failedQuota: 0, failedPublish: 1 } } })
  summary() {
    return this.jobs.failedSummary();
  }

  @Get('workers/status')
  @ApiOperation({ summary: 'Get worker status', description: 'Requires a valid ADMIN bearer token.' })
  @ApiOkResponse({ description: 'Worker status snapshot.', schema: { example: { renderWorker: { running: true }, publishWorker: { running: true } } } })
  workerStatus() {
    return this.jobs.workerStatus();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a video job by ID', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiOkResponse({ description: 'Video job details.', schema: { example: { id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', status: 'COMPLETED', slot: 'MORNING', published: true } } })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.getOne(id);
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'Get video job assets', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiOkResponse({ description: 'Assets for the job.', schema: { example: { script: 'Script text...', audioUrl: 'https://cdn.example.com/audio.mp3', videoUrl: 'https://cdn.example.com/video.mp4', scenes: [] } } })
  assets(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.getJobAssets(id);
  }

  // optional: manual run slot
  // jobs.controller.ts
@Post('run-slot')
@ApiOperation({ summary: 'Run a schedule slot manually', description: 'Requires a valid ADMIN bearer token.' })
@ApiBody({ type: RunSlotDto })
@ApiOkResponse({ description: 'Manual slot run accepted.', schema: { example: { ok: true, slot: 'MORNING' } } })
runSlot(@Body() body: RunSlotDto) {
  // should return fast (under 1s)
  return this.jobs.runSlot(body.slot, body.scheduledFor, body.force === true);
}

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a video job', description: 'Requires a valid ADMIN bearer token. Clears worker leases and prevents further retries.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiBody({ type: CancelJobDto, required: false })
  @ApiOkResponse({ description: 'Cancel result.', schema: { example: { ok: true } } })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: CancelJobDto = {}) {
    return this.jobs.cancelJob(id, body.status ?? VideoJobStatus.Cancelled);
  }

  @Post(':id/reset-render')
  @ApiOperation({ summary: 'Reset a failed video job render', description: 'Requires a valid ADMIN bearer token. Only failed jobs can be reset.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiOkResponse({ description: 'Reset result.', schema: { example: { ok: true } } })
  resetRender(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.resetRender(id);
  }

  // optional: retry
  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed video job', description: 'Requires a valid ADMIN bearer token.' })
  @ApiParam({ name: 'id', format: 'uuid', example: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c' })
  @ApiOkResponse({ description: 'Retry result.', schema: { example: { id: '4f4b01d4-1d0b-43fd-84bc-ecf162b3f05c', status: 'PENDING' } } })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.retryJob(id);
  }
}
