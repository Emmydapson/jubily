import type { RunSlot } from '@prisma/client';
import type { VideoJobStatus } from './video-job-status';

type VideoJobWithRelations = {
  id: string;
  scriptId: string;
  offerId: string | null;
  status: string;
  provider: string | null;
  videoUrl: string | null;
  youtubeVideoId: string | null;
  renderId: string | null;
  error: string | null;
  youtubeUrl: string | null;
  slot: RunSlot;
  scheduledFor: Date;
  published: boolean;
  attempts: number;
  createdAt: Date;
  videoSrt?: string | null;
  workerLockedAt?: Date | null;
  workerLockedBy?: string | null;
  workerStage?: string | null;
  thumbnailPrompt?: string | null;
  thumbnailImageUrl?: string | null;
  thumbnailStatus?: string | null;
  thumbnailError?: string | null;
  thumbnailGeneratedAt?: Date | null;
  offer?: { id: string; name: string } | null;
  script?: { id: string; topic?: { id: string; title: string } | null } | null;
};

export type VideoJobSummary = {
  id: string;
  scriptId: string;
  topicId: string | null;
  topicTitle: string | null;
  title: string;
  offerId: string | null;
  offerName: string | null;
  status: VideoJobStatus | string;
  provider: string | null;
  published: boolean;
  platform: 'youtube' | null;
  slot: RunSlot;
  scheduledFor: Date;
  createdAt: Date;
  attempts: number;
  error: string | null;
  renderId: string | null;
  videoUrl: string | null;
  youtubeUrl: string | null;
  youtubeVideoId: string | null;
  hasCaptions: boolean;
  worker: {
    lockedAt: Date | null;
    lockedBy: string | null;
    stage: string | null;
  };
  thumbnail: {
    prompt: string | null;
    imageUrl: string | null;
    status: string;
    error: string | null;
    generatedAt: Date | null;
  };
};

export function presentVideoJob(job: VideoJobWithRelations): VideoJobSummary {
  const topicTitle = job.script?.topic?.title ?? null;

  return {
    id: job.id,
    scriptId: job.scriptId,
    topicId: job.script?.topic?.id ?? null,
    topicTitle,
    title: topicTitle ?? 'Untitled',
    offerId: job.offer?.id ?? job.offerId ?? null,
    offerName: job.offer?.name ?? null,
    status: job.status,
    provider: job.provider ?? null,
    published: job.published,
    platform: job.youtubeUrl ? 'youtube' : null,
    slot: job.slot,
    scheduledFor: job.scheduledFor,
    createdAt: job.createdAt,
    attempts: job.attempts,
    error: job.error ?? null,
    renderId: job.renderId ?? null,
    videoUrl: job.videoUrl ?? null,
    youtubeUrl: job.youtubeUrl ?? null,
    youtubeVideoId: job.youtubeVideoId ?? null,
    hasCaptions: Boolean(job.videoSrt),
    worker: {
      lockedAt: job.workerLockedAt ?? null,
      lockedBy: job.workerLockedBy ?? null,
      stage: job.workerStage ?? null,
    },
    thumbnail: {
      prompt: job.thumbnailPrompt ?? null,
      imageUrl: job.thumbnailImageUrl ?? null,
      status: job.thumbnailStatus ?? 'PENDING',
      error: job.thumbnailError ?? null,
      generatedAt: job.thumbnailGeneratedAt ?? null,
    },
  };
}
