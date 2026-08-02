/**
 * Non-blocking vault layout guard runner (#277).
 * Coalesces schedules per vault; never awaited from open/sync hot paths.
 */
import {
  inspectVaultLayout,
  remediateVaultLayout,
  type FileSystemAdapter,
  type VaultContext,
  type VaultLayoutInspectReport,
  type VaultLayoutRemediateReport,
} from "@collector/core";

export interface VaultLayoutGuardRunnerDeps {
  getContext: () => VaultContext;
  onComplete?: (vaultId: string, vaultPath: string) => void;
  onError?: (vaultId: string, error: unknown) => void;
  inspect?: (
    fs: FileSystemAdapter,
    vaultPath: string,
  ) => Promise<VaultLayoutInspectReport>;
  remediate?: (
    fs: FileSystemAdapter,
    vaultPath: string,
  ) => Promise<VaultLayoutRemediateReport>;
}

export interface VaultLayoutGuardRunner {
  schedule(vaultId: string, vaultPath: string): void;
  dispose(): void;
}

type VaultJob = {
  vaultPath: string;
  running: boolean;
  rerun: boolean;
};

export function createVaultLayoutGuardRunner(
  deps: VaultLayoutGuardRunnerDeps,
): VaultLayoutGuardRunner {
  const jobs = new Map<string, VaultJob>();
  let disposed = false;
  const inspect = deps.inspect ?? inspectVaultLayout;
  const remediate = deps.remediate ?? remediateVaultLayout;

  async function run(vaultId: string): Promise<void> {
    const job = jobs.get(vaultId);
    if (!job || disposed) {
      return;
    }
    job.running = true;
    job.rerun = false;
    try {
      const fs = deps.getContext().fs;
      const inspection = await inspect(fs, job.vaultPath);
      let changed = false;
      if (!inspection.ok) {
        await remediate(fs, job.vaultPath);
        changed = true;
      }
      if (!disposed && changed) {
        deps.onComplete?.(vaultId, job.vaultPath);
      }
    } catch (error) {
      if (!disposed) {
        deps.onError?.(vaultId, error);
      }
    } finally {
      const current = jobs.get(vaultId);
      if (!current) {
        return;
      }
      current.running = false;
      if (current.rerun && !disposed) {
        void run(vaultId);
      }
    }
  }

  return {
    schedule(vaultId, vaultPath) {
      if (disposed) {
        return;
      }
      const existing = jobs.get(vaultId);
      if (existing) {
        existing.vaultPath = vaultPath;
        if (existing.running) {
          existing.rerun = true;
          return;
        }
      } else {
        jobs.set(vaultId, {
          vaultPath,
          running: false,
          rerun: false,
        });
      }
      void run(vaultId);
    },
    dispose() {
      disposed = true;
      jobs.clear();
    },
  };
}
