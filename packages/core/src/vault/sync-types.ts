import type { ItemFile } from "@collector/shared";
import type { IndexSyncPhase, IndexSyncProgress, SyncReport } from "../adapters/types.js";

export interface ReindexWork {
  itemId: string;
  diskMtimeMs: number;
  item?: ItemFile;
  content?: string | null;
  hasContentFile?: boolean;
}

export type SyncEmit = (processed: number, total: number) => void;

export function createEmptySyncReport(): SyncReport {
  return {
    skipped: 0,
    patched: 0,
    indexed: 0,
    contentIndexed: 0,
    removed: 0,
    errors: [],
  };
}

export function toSyncProgress(
  report: SyncReport,
  processed: number,
  total: number,
  phase: IndexSyncPhase = "metadata",
): IndexSyncProgress {
  return {
    phase,
    processed,
    total,
    skipped: report.skipped,
    patched: report.patched,
    indexed: report.indexed,
    contentIndexed: report.contentIndexed,
    removed: report.removed,
  };
}
