/**
 * Host-path folder bulk import (#747).
 * Walks a local directory and imports one file at a time via createDropImportService.
 */

import type {
  AttachMediaFileInput,
  CreateItemInput,
  ImportFolderFailure,
  ImportFolderResult,
  ImportFolderResultStatus,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  importFolderJobType,
  type ImportFolderJobPayload,
} from "@collector/shared";
import {
  classifyDropFilename,
  normalizeRelativePath,
  parseDocumentMarkdown,
  partitionDocumentFrontmatter,
  yieldToEventLoop,
  INDEX_SYNC_YIELD_MS,
} from "@collector/core";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { createDropImportService } from "../../drop-import.js";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";
import { createJobResultMailbox } from "../job-result-mailbox.js";

const SAMPLE_FAILURE_LIMIT = 20;

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

export type ImportFolderFatalCode =
  | "active_vault_mismatch"
  | "no_active_vault"
  | "sqlite_error"
  | "index_unavailable"
  | "invalid_source"
  | "infrastructure";

/** Typed fatal signal for folder import — preferred over message heuristics. */
export class ImportFolderFatalError extends Error {
  readonly code: ImportFolderFatalCode;

  constructor(code: ImportFolderFatalCode, message: string) {
    super(message);
    this.name = "ImportFolderFatalError";
    this.code = code;
  }
}

type MutableImportFolderResult = {
  createdIds: string[];
  skippedIds: string[];
  failures: ImportFolderFailure[];
  failedCount: number;
};

function emptyMutableResult(): MutableImportFolderResult {
  return {
    createdIds: [],
    skippedIds: [],
    failures: [],
    failedCount: 0,
  };
}

function deriveResultStatus(
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

function finalizeResult(
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
    status: options?.forceStatus ?? deriveResultStatus(result),
  };
}

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}

/** Canonical url from note frontmatter when present and non-empty. */
function canonicalUrlFromNoteBytes(bytes: Uint8Array): string | null {
  const parsed = parseDocumentMarkdown(decodeUtf8(bytes));
  const { known } = partitionDocumentFrontmatter(parsed.frontmatter);
  const url = known.url;
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function listSourceFiles(
  sourceDirAbs: string,
): Promise<Array<{ absPath: string; relativePath: string; name: string }>> {
  const out: Array<{ absPath: string; relativePath: string; name: string }> =
    [];
  async function walk(dirAbs: string): Promise<void> {
    const entries = await readdir(dirAbs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const absPath = join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath =
        normalizeRelativePath(
          relative(sourceDirAbs, absPath).replace(/\\/g, "/"),
        ) || entry.name;
      out.push({
        absPath,
        relativePath,
        name: basename(absPath),
      });
    }
  }
  await walk(sourceDirAbs);
  return out;
}

function pushFailureSample(
  failures: ImportFolderFailure[],
  relativePath: string,
  error: string,
): void {
  if (failures.length >= SAMPLE_FAILURE_LIMIT) {
    return;
  }
  failures.push({ relativePath, error });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inferFatalCodeFromMessage(
  message: string,
): ImportFolderFatalCode | null {
  if (/active vault mismatch/i.test(message)) {
    return "active_vault_mismatch";
  }
  if (/no active vault/i.test(message)) {
    return "no_active_vault";
  }
  if (/SQLITE_/i.test(message)) {
    return "sqlite_error";
  }
  if (/database is (closed|locked|not open)/i.test(message)) {
    return "sqlite_error";
  }
  if (/index (is )?(closed|unavailable|not (ready|open))/i.test(message)) {
    return "index_unavailable";
  }
  return null;
}

/**
 * Vault/index infrastructure failures must abort the job; per-file import
 * validation/content errors may continue after structured logging.
 * Prefer {@link ImportFolderFatalError}; message heuristics remain for
 * errors thrown by lower layers that lack a typed code.
 */
export function isFatalImportFolderError(error: unknown): boolean {
  if (error instanceof ImportFolderFatalError) {
    return true;
  }
  return inferFatalCodeFromMessage(errorMessage(error)) !== null;
}

function nonRetryableFail(error: string): JobHandlerResult {
  return { status: "fail", retryable: false, error };
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
    if (!isAbsolute(sourceDirAbs)) {
      return nonRetryableFail(
        `importFolder sourceDirAbs must be absolute: ${sourceDirAbs}`,
      );
    }

    try {
      const sourceStat = await stat(sourceDirAbs);
      if (!sourceStat.isDirectory()) {
        return nonRetryableFail(
          `importFolder sourceDirAbs is not a directory: ${sourceDirAbs}`,
        );
      }
      await deps.assertActiveVault(vaultId);
    } catch (error) {
      if (isFatalImportFolderError(error)) {
        console.error("[importFolder] fatal infrastructure error", {
          jobId: job.id,
          vaultId,
          error: errorMessage(error),
        });
      }
      return nonRetryableFail(errorMessage(error));
    }

    const result = emptyMutableResult();
    let files: Array<{ absPath: string; relativePath: string; name: string }>;
    try {
      files = await listSourceFiles(sourceDirAbs);
    } catch (error) {
      console.error("[importFolder] fatal infrastructure error", {
        jobId: job.id,
        vaultId,
        error: errorMessage(error),
      });
      return nonRetryableFail(errorMessage(error));
    }

    const folder_path = targetFolderPath?.trim() || undefined;

    for (const file of files) {
      const classified = classifyDropFilename(file.name);
      if (classified.kind === "skip") {
        continue;
      }

      try {
        await deps.assertActiveVault(vaultId);

        const bytes = new Uint8Array(await readFile(file.absPath));

        if (classified.kind === "note") {
          const url = canonicalUrlFromNoteBytes(bytes);
          if (url) {
            // Index lookup: infrastructure failure aborts (no per-file swallow).
            const existingId = await deps.findItemIdByUrl(vaultId, url);
            if (existingId) {
              result.skippedIds.push(existingId);
              await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
              continue;
            }
          }
        }

        const imported = await importer.importDroppedFiles({
          folder_path,
          files: [
            {
              name: file.name,
              relativePath: file.relativePath,
              bytes,
            },
          ],
        });
        for (const id of imported.createdIds) {
          result.createdIds.push(id);
        }
      } catch (error) {
        if (isFatalImportFolderError(error)) {
          console.error("[importFolder] fatal infrastructure error", {
            jobId: job.id,
            vaultId,
            relativePath: file.relativePath,
            error: errorMessage(error),
          });
          // Job row will be `failed`; never leave mailbox status as `ok`.
          importFolderResults.set(
            job.id,
            finalizeResult(result, { forceStatus: "failed" }),
          );
          return nonRetryableFail(errorMessage(error));
        }
        const message = errorMessage(error);
        console.error("[importFolder] per-file import failed", {
          jobId: job.id,
          vaultId,
          relativePath: file.relativePath,
          error: message,
        });
        result.failedCount += 1;
        pushFailureSample(result.failures, file.relativePath, message);
      }

      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }

    importFolderResults.set(job.id, finalizeResult(result));
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
