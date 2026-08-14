import type {
  AttachMediaFileInput,
  CreateItemInput,
  ImportDroppedFilesResult,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  dropImportBatchJobType,
  type DropImportBatchJobPayload,
} from "@collector/shared";
import { readFile } from "node:fs/promises";
import { basename, relative } from "node:path";
import {
  prepareDroppedNoteMarkdown,
  resolveImportItemFolder,
} from "../../drop-import.js";
import {
  classifyDropFilename,
  resolveDropTitle,
  titleStemFromFilename,
} from "@collector/core";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

const dropImportResultsByJobId = new Map<string, ImportDroppedFilesResult>();

export function takeDropImportResult(
  jobId: string,
): ImportDroppedFilesResult | null {
  const result = dropImportResultsByJobId.get(jobId) ?? null;
  dropImportResultsByJobId.delete(jobId);
  return result;
}

export function createDropImportBatchHandler(deps: {
  createItem: (input: CreateItemInput) => Promise<ItemFile>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  updateItemSource: (
    itemId: string,
    rawMarkdown: string,
  ) => Promise<ItemFile>;
}): TypedJobHandler<typeof dropImportBatchJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    const createdIds: string[] = [];
    const target = job.payload.targetFolderId?.trim() || undefined;
    const errors: string[] = [];

    for (const absPath of job.payload.paths) {
      const name = basename(absPath);
      const relativePath = relative(job.payload.stagingDir, absPath).replace(/\\/g, "/") || name;
      const classified = classifyDropFilename(name);
      if (classified.kind === "skip") {
        continue;
      }
      try {
        const bytes = new Uint8Array(await readFile(absPath));
        const folder_path = resolveImportItemFolder(target, relativePath);
        if (classified.kind === "media") {
          const item = await deps.createItem({
            title: titleStemFromFilename(name),
            content_type: classified.contentType,
            folder_path,
            source_type: "import",
          });
          await deps.attachMediaFiles(item.id, [{ name, bytes }]);
          createdIds.push(item.id);
          continue;
        }
        const raw = new TextDecoder("utf-8").decode(bytes);
        const title = resolveDropTitle(name, raw);
        const item = await deps.createItem({
          title,
          content_type: "note",
          folder_path,
          source_type: "import",
        });
        await deps.updateItemSource(
          item.id,
          prepareDroppedNoteMarkdown(raw, title),
        );
        createdIds.push(item.id);
      } catch (error) {
        errors.push(
          `${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    dropImportResultsByJobId.set(job.id, { createdIds });
    if (errors.length > 0 && createdIds.length === 0) {
      return {
        status: "fail",
        retryable: false,
        error: errors.join("; "),
      };
    }
    if (errors.length > 0) {
      return {
        status: "fail",
        retryable: false,
        error: `partial drop-import failures: ${errors.join("; ")}`,
      };
    }
    return { status: "ok" };
  };
}

export function enqueueDropImportBatch(
  queue: JobQueue,
  payload: DropImportBatchJobPayload,
): Promise<EnqueueResult> {
  return queue.enqueue({
    type: "dropImportBatch",
    payload,
  });
}
