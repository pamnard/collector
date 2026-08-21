/**
 * Host-path folder bulk import (#747).
 * Walks a local directory and imports one file at a time via createDropImportService.
 */

import type {
  AttachMediaFileInput,
  CreateItemInput,
  ImportFolderFailure,
  ImportFolderResult,
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

const importFolderResults = createJobResultMailbox<ImportFolderResult>();

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

function emptyResult(): ImportFolderResult {
  return {
    createdIds: [],
    skippedIds: [],
    failures: [],
    created: 0,
    skipped: 0,
    failed: 0,
  };
}

function finalizeCounts(result: ImportFolderResult): ImportFolderResult {
  return {
    ...result,
    created: result.createdIds.length,
    skipped: result.skippedIds.length,
    failed: result.failures.length,
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

function pushFailure(
  failures: ImportFolderFailure[],
  relativePath: string,
  error: string,
): void {
  if (failures.length >= SAMPLE_FAILURE_LIMIT) {
    return;
  }
  failures.push({ relativePath, error });
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
}): TypedJobHandler<typeof importFolderJobType.payload> {
  const importer = createDropImportService(deps);
  return async (job): Promise<JobHandlerResult> => {
    const { vaultId, sourceDirAbs, targetFolderPath } = job.payload;
    if (!isAbsolute(sourceDirAbs)) {
      throw new Error(`importFolder sourceDirAbs must be absolute: ${sourceDirAbs}`);
    }
    const sourceStat = await stat(sourceDirAbs);
    if (!sourceStat.isDirectory()) {
      throw new Error(`importFolder sourceDirAbs is not a directory: ${sourceDirAbs}`);
    }

    const result = emptyResult();
    const files = await listSourceFiles(sourceDirAbs);
    const folder_path = targetFolderPath?.trim() || undefined;

    for (const file of files) {
      const classified = classifyDropFilename(file.name);
      if (classified.kind === "skip") {
        continue;
      }

      const bytes = new Uint8Array(await readFile(file.absPath));

      if (classified.kind === "note") {
        const url = canonicalUrlFromNoteBytes(bytes);
        if (url) {
          const existingId = await deps.findItemIdByUrl(vaultId, url);
          if (existingId) {
            result.skippedIds.push(existingId);
            await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
            continue;
          }
        }
      }

      try {
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
        const message =
          error instanceof Error ? error.message : String(error);
        pushFailure(result.failures, file.relativePath, message);
      }

      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }

    importFolderResults.set(job.id, finalizeCounts(result));
    return { status: "ok" };
  };
}

export function enqueueImportFolder(
  queue: JobQueue,
  payload: ImportFolderJobPayload,
): Promise<EnqueueResult> {
  return queue.enqueue({
    type: "importFolder",
    payload,
  });
}
