import {
  JOB_PRIORITY_BULK,
  vaultIndexSyncJobType,
  type VaultIndexSyncJobPayload,
} from "@collector/shared";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

export function createVaultIndexSyncHandler(deps: {
  startVaultIndexSync: (vaultId: string, vaultPath: string) => Promise<void>;
  /** Enqueue full tag catalog reconcile after sync (#935). */
  enqueueTagCatalogReconcile?: (
    vaultId: string,
    vaultPath: string,
  ) => Promise<void>;
}): TypedJobHandler<typeof vaultIndexSyncJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    await deps.startVaultIndexSync(job.payload.vaultId, job.payload.vaultPath);
    // Kickoff syncs are frequent (list/subscribe); full reconcile there races
    // ensure→pin and drops fresh FM tags. Write-path candidate prune + force/
    // recovery syncs still run full reconcile.
    if (
      deps.enqueueTagCatalogReconcile &&
      job.payload.reason !== "kickoff"
    ) {
      await deps.enqueueTagCatalogReconcile(
        job.payload.vaultId,
        job.payload.vaultPath,
      );
    }
    return { status: "ok" };
  };
}

export function enqueueVaultIndexSync(
  queue: JobQueue,
  payload: VaultIndexSyncJobPayload,
): Promise<EnqueueResult> {
  return queue.enqueue({
    type: "vaultIndexSync",
    payload,
    priority: JOB_PRIORITY_BULK,
    idempotencyKey: `vaultIndexSync:${payload.vaultId}`,
  });
}
