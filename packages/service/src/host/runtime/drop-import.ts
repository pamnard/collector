import type { ImportDroppedFilesInput } from "@collector/api";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DropImportService } from "../../drop-import.js";
import {
  enqueueDropImportBatch,
  takeDropImportResult,
} from "../../jobs/handlers/drop-import-batch.js";
import type { JobQueue } from "../../jobs/job-queue.js";
import { enqueueAndAwaitResult } from "../../jobs/job-wait.js";

export function createHostDropImport(deps: {
  dataDir: string;
  resolveActiveVault: () => Promise<{ vault: { id: string } }>;
  requireJobs: () => JobQueue;
}): DropImportService {
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
        return enqueueAndAwaitResult({
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
  };
}
