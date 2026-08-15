import type { JobStats, JobStatusCounts } from "@collector/api";

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type { JobStats, JobStatusCounts };

export interface JobRow {
  id: string;
  type: string;
  payload_json: string;
  status: JobStatus;
  priority: number;
  idempotency_key: string | null;
  attempts: number;
  max_attempts: number;
  available_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueRecord {
  id: string;
  type: string;
  payloadJson: string;
  priority: number;
  idempotencyKey: string | null;
  maxAttempts: number;
  availableAt: string;
  createdAt: string;
}

export function emptyStatusCounts(): JobStatusCounts {
  return {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
}
