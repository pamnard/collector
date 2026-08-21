import type {
  ImportDroppedFilesInput,
  ImportFolderInput,
  ImportFolderJobSnapshot,
} from "@collector/api";
import type { JobQueue } from "../../jobs/job-queue.js";
import {
  enqueueDropImportBatch,
  takeDropImportResult,
} from "../../jobs/handlers/drop-import-batch.js";
import {
  enqueueImportFolder,
  peekImportFolderResult,
} from "../../jobs/handlers/import-folder.js";
import { enqueueAndAwaitResult } from "../../jobs/job-wait.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export interface DropImportRuntimeDeps {
  dataDir: string;
  resolveActiveVault: () => Promise<{ vault: { id: string } }>;
  requireJobs: () => JobQueue;
}

export function createDropImportRuntime(deps: DropImportRuntimeDeps) {
  return {
    async importDroppedFiles(input: ImportDroppedFilesInput) {
      const active = await deps.resolveActiveVault();
      const stagingDir = join(
        deps.dataDir,
        "drop-import-staging",
        crypto.randomUUID(),
      );
      await mkdir(stagingDir, { recursive: true });
      const paths: string[] = [];
      try {
        for (const file of input.files) {
          const rel = file.relativePath.replace(/\\/g, "/");
          const dest = join(stagingDir, rel);
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, file.bytes);
          paths.push(dest);
        }
        if (paths.length === 0) {
          return { createdIds: [] };
        }
        return await enqueueAndAwaitResult({
          queue: deps.requireJobs(),
          label: "dropImportBatch",
          takeResult: takeDropImportResult,
          acceptFailed: true,
          enqueue: () =>
            enqueueDropImportBatch(deps.requireJobs(), {
              vaultId: active.vault.id,
              stagingDir,
              paths,
              targetFolderId: input.folder_path?.trim() || null,
            }),
        });
      } finally {
        await rm(stagingDir, { recursive: true, force: true });
      }
    },

    /** Fire-and-forget host folder import (#747). */
    async importFolder(input: ImportFolderInput): Promise<{ jobId: string }> {
      if (!isAbsolute(input.sourceDirAbs)) {
        throw new Error(
          `importFolder sourceDirAbs must be absolute: ${input.sourceDirAbs}`,
        );
      }
      const active = await deps.resolveActiveVault();
      const { id } = await enqueueImportFolder(deps.requireJobs(), {
        vaultId: active.vault.id,
        sourceDirAbs: input.sourceDirAbs,
        ...(input.targetFolderPath?.trim()
          ? { targetFolderPath: input.targetFolderPath.trim() }
          : {}),
      });
      return { jobId: id };
    },

    async getImportFolderJob(jobId: string): Promise<ImportFolderJobSnapshot> {
      const row = await deps.requireJobs().getJob(jobId);
      if (!row) {
        throw new Error(`importFolder job not found: ${jobId}`);
      }
      // Always peek: repeated polls after success must keep returning the same
      // result snapshot (take would drain the mailbox on the first terminal poll).
      const result = peekImportFolderResult(jobId);
      return {
        jobId,
        status: row.status as ImportFolderJobSnapshot["status"],
        result,
        error: row.last_error,
      };
    },
  };
}
