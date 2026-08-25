/**
 * Host-path folder bulk import (#747).
 * Walks a local directory and imports one file at a time via createDropImportService.
 */

import type {
  AttachMediaFileInput,
  CreateItemInput,
  ImportFolderResult,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  importFolderJobType,
  type ImportFolderJobPayload,
} from "@collector/shared";
import { yieldToEventLoop, INDEX_SYNC_YIELD_MS } from "@collector/core";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createDropImportService } from "../../drop-import.js";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";
import { createJobResultMailbox } from "../job-result-mailbox.js";
import {
  importFolderErrorMessage,
  isFatalImportFolderError,
} from "./import-folder-fatal.js";
import {
  emptyMutableImportFolderResult,
  finalizeImportFolderResult,
} from "./import-folder-result.js";
import { listImportFolderSourceFiles } from "./import-folder-walk.js";
import {
  applyImportFolderFileOutcome,
  importOneFolderFile,
} from "./import-folder-file.js";

export {
  ImportFolderFatalError,
  isFatalImportFolderError,
  type ImportFolderFatalCode,
} from "./import-folder-fatal.js";

/** Keep peek-only CLI snapshots around long enough for --wait, then drop. */
const IMPORT_FOLDER_RESULT_TTL_MS = 6 * 60 * 60 * 1000;

const importFolderResults = createJobResultMailbox<ImportFolderResult>({
  ttlMs: IMPORT_FOLDER_RESULT_TTL_MS,
});

export function takeImportFolderResult(
  jobId: string,
): ImportFolderResult | null {
  return importFolderResults.take(jobId);
}

export function peekImportFolderResult(
  jobId: string,
): ImportFolderResult | null {
  return importFolderResults.peek(jobId);
}

function nonRetryableFail(error: string): JobHandlerResult {
  return { status: "fail", retryable: false, error };
}

function logImportFolderFatal(
  fields: Record<string, string>,
): void {
  console.error("[importFolder] fatal infrastructure error", fields);
}

async function validateImportFolderSource(
  sourceDirAbs: string,
): Promise<JobHandlerResult | null> {
  if (!isAbsolute(sourceDirAbs)) {
    return nonRetryableFail(
      `importFolder sourceDirAbs must be absolute: ${sourceDirAbs}`,
    );
  }
  const sourceStat = await stat(sourceDirAbs);
  if (!sourceStat.isDirectory()) {
    return nonRetryableFail(
      `importFolder sourceDirAbs is not a directory: ${sourceDirAbs}`,
    );
  }
  return null;
}

export function createImportFolderHandler(deps: {
  createItem: (input: CreateItemInput) => Promise<ItemFile>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  updateItemSource: (
    itemId: string,
    rawMarkdown: string,
  ) => Promise<ItemFile>;
  findItemIdByUrl: (
    vaultId: string,
    url: string,
  ) => Promise<string | null>;
  /** Fail-fast when active vault ≠ payload vaultId (create/import bind to active). */
  assertActiveVault: (vaultId: string) => Promise<void>;
}): TypedJobHandler<typeof importFolderJobType.payload> {
  const importer = createDropImportService(deps);
  return async (job): Promise<JobHandlerResult> => {
    const { vaultId, sourceDirAbs, targetFolderPath } = job.payload;

    try {
      const sourceError = await validateImportFolderSource(sourceDirAbs);
      if (sourceError) {
        return sourceError;
      }
      await deps.assertActiveVault(vaultId);
    } catch (error) {
      const message = importFolderErrorMessage(error);
      if (isFatalImportFolderError(error)) {
        logImportFolderFatal({ jobId: job.id, vaultId, error: message });
      }
      return nonRetryableFail(message);
    }

    const result = emptyMutableImportFolderResult();
    let files;
    try {
      files = await listImportFolderSourceFiles(sourceDirAbs);
    } catch (error) {
      const message = importFolderErrorMessage(error);
      logImportFolderFatal({ jobId: job.id, vaultId, error: message });
      return nonRetryableFail(message);
    }

    const folder_path = targetFolderPath?.trim() || undefined;

    for (const file of files) {
      const outcome = await importOneFolderFile({
        file,
        vaultId,
        folder_path,
        importer,
        assertActiveVault: deps.assertActiveVault,
        findItemIdByUrl: deps.findItemIdByUrl,
      });

      if (outcome.kind === "fatal") {
        logImportFolderFatal({
          jobId: job.id,
          vaultId,
          relativePath: file.relativePath,
          error: outcome.error,
        });
        // Job row will be `failed`; never leave mailbox status as `ok`.
        importFolderResults.set(
          job.id,
          finalizeImportFolderResult(result, { forceStatus: "failed" }),
        );
        return nonRetryableFail(outcome.error);
      }

      if (outcome.kind === "per_file_fail") {
        console.error("[importFolder] per-file import failed", {
          jobId: job.id,
          vaultId,
          relativePath: file.relativePath,
          error: outcome.error,
        });
      }

      applyImportFolderFileOutcome(result, file, outcome);
      if (outcome.kind !== "skipped_kind") {
        await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
      }
    }

    importFolderResults.set(job.id, finalizeImportFolderResult(result));
    return { status: "ok" };
  };
}

export function enqueueImportFolder(
  queue: JobQueue,
  payload: ImportFolderJobPayload,
): Promise<EnqueueResult> {
  if (importFolderJobType.maxAttempts === undefined) {
    throw new Error("importFolder job type must declare maxAttempts");
  }
  return queue.enqueue({
    type: "importFolder",
    payload,
    maxAttempts: importFolderJobType.maxAttempts,
  });
}
