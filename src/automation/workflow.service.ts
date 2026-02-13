/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type StepStatus = 'pending' | 'active' | 'done';
type Slot = 'MORNING' | 'AFTERNOON' | 'EVENING';

@Injectable()
export class WorkflowService {
  constructor(private prisma: PrismaService) {}

  private startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfToday() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private computeFromJobs(jobs: { status: string; published: boolean; offerId: string | null }[]) {
    const hasJobs = jobs.length > 0;
    const hasOffer = jobs.some(j => !!j.offerId);

    const anyProcessing = jobs.some(j => String(j.status).toUpperCase() === 'PROCESSING');
    const anyCompleted = jobs.some(j => String(j.status).toUpperCase() === 'COMPLETED');
    const anyPublished = jobs.some(j => j.published === true);
    const anyFailed = jobs.some(j => String(j.status).toUpperCase() === 'FAILED');

    const steps: { key: string; status: StepStatus }[] = [
      { key: 'trigger', status: hasJobs ? 'done' : 'pending' },
      { key: 'topics', status: hasJobs ? 'done' : 'pending' }, // in your system job implies topic->script happened
      { key: 'offers', status: hasOffer ? 'done' : hasJobs ? 'active' : 'pending' },
      { key: 'scripts', status: hasJobs ? 'done' : 'pending' },
      { key: 'render', status: anyCompleted ? 'done' : anyProcessing ? 'active' : hasJobs ? 'pending' : 'pending' },
      { key: 'publish', status: anyPublished ? 'done' : anyCompleted ? 'active' : 'pending' },
      { key: 'logging', status: (anyPublished || anyFailed) ? 'done' : 'pending' },
    ];

    return { steps, anyPublished, anyFailed, anyProcessing, anyCompleted, hasJobs, hasOffer };
  }

  async getStatus() {
    const from = this.startOfToday();
    const to = this.endOfToday();

    // ✅ Slot-aware: use scheduledFor, not createdAt
    const jobs = await this.prisma.videoJob.findMany({
      where: { scheduledFor: { gte: from, lte: to } },
      select: { slot: true, status: true, published: true, offerId: true, scheduledFor: true },
      orderBy: { scheduledFor: 'asc' },
    });

    const bySlot: Record<Slot, any[]> = {
      MORNING: [],
      AFTERNOON: [],
      EVENING: [],
    };

    for (const j of jobs) {
      const s = String(j.slot) as Slot;
      if (bySlot[s]) bySlot[s].push(j);
    }

    const morning = this.computeFromJobs(bySlot.MORNING);
    const afternoon = this.computeFromJobs(bySlot.AFTERNOON);
    const evening = this.computeFromJobs(bySlot.EVENING);

    // ✅ Overall steps: combine (if any slot is active/done)
    const combine = (key: string): StepStatus => {
      const vals = [
        morning.steps.find(s => s.key === key)?.status,
        afternoon.steps.find(s => s.key === key)?.status,
        evening.steps.find(s => s.key === key)?.status,
      ] as StepStatus[];

      if (vals.includes('active')) return 'active';
      if (vals.includes('done')) return 'done';
      return 'pending';
    };

    const steps = [
      { key: 'trigger', status: combine('trigger') },
      { key: 'topics', status: combine('topics') },
      { key: 'offers', status: combine('offers') },
      { key: 'scripts', status: combine('scripts') },
      { key: 'render', status: combine('render') },
      { key: 'publish', status: combine('publish') },
      { key: 'logging', status: combine('logging') },
    ];

    return {
      date: from.toISOString(),
      steps,
      slots: {
        MORNING: { steps: morning.steps, jobs: bySlot.MORNING.length },
        AFTERNOON: { steps: afternoon.steps, jobs: bySlot.AFTERNOON.length },
        EVENING: { steps: evening.steps, jobs: bySlot.EVENING.length },
      },
      summary: {
        jobs: jobs.length,
        published: jobs.some(j => j.published),
        failed: jobs.some(j => String(j.status).toUpperCase() === 'FAILED'),
      },
    };
  }
}
