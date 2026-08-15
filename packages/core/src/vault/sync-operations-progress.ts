import type {
  IndexSyncPhase,
  IndexSyncProgress,
  SyncReport,
} from "../adapters/types.js";
import type { ItemFile } from "@collector/shared";

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

export interface ReindexWork {
  itemId: string;
  diskMtimeMs: number;
  item?: ItemFile;
  content?: string | null;
  hasContentFile?: boolean;
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
