import type { JobPermanentFailure } from "@collector/api";
import { itemDerivedRefreshJobType } from "@collector/shared";
import type { JobRow } from "./job-store.js";

/** AlertStack summary — no raw job-type ids for known paths. */
export function permanentFailureSummary(jobType: string, error: string): string {
  if (jobType === itemDerivedRefreshJobType.id) {
    if (/failed to download|localizeRemoteDisplayAssets|ENAMETOOLONG/i.test(error)) {
      return "Не удалось скачать картинку в заметке";
    }
    return "Не удалось обновить материалы заметки";
  }
  return `Задача «${jobType}» не выполнилась`;
}

export function reportPermanentFailure(
  job: JobRow,
  error: string,
  attempts: number,
  onPermanentFailure?: (info: JobPermanentFailure) => void,
): void {
  const info: JobPermanentFailure = {
    id: job.id,
    type: job.type,
    summary: permanentFailureSummary(job.type, error),
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
