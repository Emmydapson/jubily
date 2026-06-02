export enum VideoJobStatus {
  Pending = 'PENDING',
  Processing = 'PROCESSING',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  FailedPermanent = 'FAILED_PERMANENT',
  FailedQuota = 'FAILED_QUOTA',
  FailedPublish = 'FAILED_PUBLISH',
  Cancelled = 'CANCELLED',
}

export const VIDEO_JOB_STATUSES = Object.values(VideoJobStatus);
