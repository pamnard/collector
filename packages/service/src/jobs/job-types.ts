export type JobHandlerResult =
  | { status: "ok" }
  | { status: "fail"; retryable: false; error: string }
  | { status: "fail"; retryable: true; error: string; retryAfterMs?: number };

export interface JobHandlerInput {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

export type JobHandler = (job: JobHandlerInput) => Promise<JobHandlerResult>;
