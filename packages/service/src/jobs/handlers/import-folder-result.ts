import type {
  ImportFolderFailure,
  ImportFolderResult,
  ImportFolderResultStatus,
} from "@collector/api";

export const IMPORT_FOLDER_SAMPLE_FAILURE_LIMIT = 20;

export type MutableImportFolderResult = {
  createdIds: string[];
  skippedIds: string[];
  failures: ImportFolderFailure[];
  failedCount: number;
};

export function emptyMutableImportFolderResult(): MutableImportFolderResult {
  return {
    createdIds: [],
    skippedIds: [],
    failures: [],
    failedCount: 0,
  };
}

export function deriveImportFolderResultStatus(
  result: MutableImportFolderResult,
): ImportFolderResultStatus {
  if (result.failedCount === 0) {
    return "ok";
  }
  if (result.createdIds.length > 0 || result.skippedIds.length > 0) {
    return "partial";
  }
  return "failed";
}

export function finalizeImportFolderResult(
  result: MutableImportFolderResult,
  options?: { forceStatus?: ImportFolderResultStatus },
): ImportFolderResult {
  return {
    createdIds: result.createdIds,
    skippedIds: result.skippedIds,
    failures: result.failures,
    created: result.createdIds.length,
    skipped: result.skippedIds.length,
    failed: result.failedCount,
    status: options?.forceStatus ?? deriveImportFolderResultStatus(result),
  };
}

export function pushImportFolderFailureSample(
  failures: ImportFolderFailure[],
  relativePath: string,
  error: string,
  sampleLimit: number = IMPORT_FOLDER_SAMPLE_FAILURE_LIMIT,
): void {
  if (failures.length >= sampleLimit) {
    return;
  }
  failures.push({ relativePath, error });
}
