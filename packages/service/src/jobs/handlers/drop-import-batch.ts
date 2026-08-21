import type {
  AttachMediaFileInput,
  CreateItemInput,
  ImportDroppedFilesResult,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  JOB_PRIORITY_BULK,
  dropImportBatchJobType,
  type DropImportBatchJobPayload,
} from "@collector/shared";
import { readFile } from "node:fs/promises";
import { basename, relative } from "node:path";
import { createDropImportService } from "../../drop-import.js";
import { normalizeRelativePath } from "@collector/core";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";
import { createJobResultMailbox } from "../job-result-mailbox.js";

const dropImportResults = createJobResultMailbox<ImportDroppedFilesResult>();

export function takeDropImportResult(
  jobId: string,
): ImportDroppedFilesResult | null {
  return dropImportResults.take(jobId);
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
  const importer = createDropImportService(deps);
  return async (job): Promise<JobHandlerResult> => {
    const files = [];
    for (const absPath of job.payload.paths) {
      const name = basename(absPath);
      const relativePath =
        normalizeRelativePath(
          relative(job.payload.stagingDir, absPath).replace(/\\/g, "/"),
        ) || name;
      files.push({
        name,
        relativePath,
        bytes: new Uint8Array(await readFile(absPath)),
      });
    }
    const result = await importer.importDroppedFiles({
      folder_path: job.payload.targetFolderId?.trim() || undefined,
      files,
    });
    dropImportResults.set(job.id, result);
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
    priority: JOB_PRIORITY_BULK,
  });
}
