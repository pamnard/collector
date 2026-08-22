/**
 * Host surface for opt-in waitDerived (#770).
 * Keeps job-wait out of items-crud so default mutate stays fire-and-forget.
 */

import type { WaitDerivedResult } from "@collector/api";
import type { JobQueue } from "../../jobs/job-queue.js";
import { waitDerived as waitDerivedJob } from "../../jobs/wait-derived.js";

export interface WaitDerivedRuntimeDeps {
  resolveActiveVault: () => Promise<{ vault: { id: string } }>;
  requireJobs: () => JobQueue;
}

export function createWaitDerivedRuntime(deps: WaitDerivedRuntimeDeps) {
  return {
    async waitDerived(
      itemId: string,
      contentRevision: number,
      options?: { timeoutMs?: number },
    ): Promise<WaitDerivedResult> {
      const { vault } = await deps.resolveActiveVault();
      return waitDerivedJob({
        queue: deps.requireJobs(),
        vaultId: vault.id,
        itemId,
        contentRevision,
        ...(options?.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.timeoutMs }),
      });
    },
  };
}
