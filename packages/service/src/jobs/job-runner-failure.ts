import type { JobPermanentFailure } from "@collector/api";
import type { JobRow } from "./job-store.js";

export function reportPermanentFailure(
  job: JobRow,
  error: string,
  attempts: number,
  onPermanentFailure?: (info: JobPermanentFailure) => void,
): void {
  const info: JobPermanentFailure = {
    id: job.id,
    type: job.type,
    summary: `Задача «${job.type}» не выполнилась`,
    detail: error,
    attempts,
  };
  console.error("[jobs] permanent failure", {
    jobId: info.id,
    type: info.type,
    summary: info.summary,
    detail: info.detail,
    attempts: info.attempts,
  });
  onPermanentFailure?.(info);
}

export type ReportPermanentFailure = (
  job: JobRow,
  error: string,
  attempts: number,
) => void;
