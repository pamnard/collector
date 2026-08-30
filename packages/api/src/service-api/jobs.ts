import type { Subscription } from "./shared.js";

/** Aggregate job counts by status (#630). */
export interface JobStatusCounts {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
}

/** Queue stats including optional per-type breakdown (#630). */
export interface JobStats extends JobStatusCounts {
  byType: Record<string, JobStatusCounts>;
}

/** Terminal job failure payload for AlertStack (#630). */
export interface JobPermanentFailure {
  id: string;
  type: string;
  error: string;
  attempts: number;
}

/** Read-only job queue observability port (#630). */
export interface JobsPort {
  getJobStats(): Promise<JobStats>;
  subscribeJobPermanentFailure(
    onUpdate: (failure: JobPermanentFailure) => void,
  ): Subscription;
}
