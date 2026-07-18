import type { FileSystemAdapter } from "../adapters/types.js";
import { yieldToEventLoop } from "../util/concurrency.js";
import {
  createDefaultAppSettings,
  mergeAppSettings,
  readAppSettings,
  writeAppSettings,
} from "../settings/app-settings-io.js";
import { joinSegments, vaultMetaPath, vaultRoot } from "./paths.js";

/** Vault dirs are UUID folders only — skip backups / stray names under vaults/. */
const VAULT_DIR_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BOOTSTRAP_LOCK_NAME = ".bootstrap.lock";
const BOOTSTRAP_LOCK_TIMEOUT_MS = 30_000;
const BOOTSTRAP_LOCK_POLL_MS = 20;

export async function listIncompleteVaultDirIds(
  fs: FileSystemAdapter,
  vaultsRootPath: string,
): Promise<string[]> {
  if (!(await fs.exists(vaultsRootPath))) {
    return [];
  }

  const incomplete: string[] = [];
  for (const name of await fs.readDir(vaultsRootPath)) {
    if (!VAULT_DIR_ID_RE.test(name)) {
      continue;
    }
    const path = vaultRoot(vaultsRootPath, name);
    if (!(await fs.exists(vaultMetaPath(path)))) {
      incomplete.push(name);
    }
  }
  return incomplete.sort();
}

export async function assertNoIncompleteVaultDirs(
  fs: FileSystemAdapter,
  vaultsRootPath: string,
): Promise<void> {
  const incomplete = await listIncompleteVaultDirIds(fs, vaultsRootPath);
  if (incomplete.length === 0) {
    return;
  }

  throw new Error(
    `Incomplete vault directory (missing vault.meta.json): ${incomplete[0]}`,
  );
}

/**
 * Cross-process exclusive lock around empty-tree Default Vault create.
 * Uses `writeTextExclusive` (Node `wx` / Rust `create_new`).
 */
export async function withVaultBootstrapLock<T>(
  fs: FileSystemAdapter,
  vaultsRootPath: string,
  work: () => Promise<T>,
): Promise<T> {
  await fs.mkdir(vaultsRootPath);
  // Use joinSegments (not fs.join): Tauri adapter used to strip the leading `/` (#181).
  const lockPath = joinSegments(vaultsRootPath, BOOTSTRAP_LOCK_NAME);
  await acquireVaultBootstrapLock(fs, lockPath);
  try {
    return await work();
  } finally {
    await fs.remove(lockPath);
  }
}

/**
 * Under the bootstrap lock: re-resolve existing complete vaults, refuse
 * incomplete UUID dirs, then run create (caller persists active_vault_id).
 */
export async function runEmptyVaultBootstrap<T>(
  fs: FileSystemAdapter,
  vaultsRootPath: string,
  options: {
    tryResolveExisting: () => Promise<T | null>;
    create: () => Promise<T>;
  },
): Promise<T> {
  return withVaultBootstrapLock(fs, vaultsRootPath, async () => {
    const existing = await options.tryResolveExisting();
    if (existing) {
      return existing;
    }
    await assertNoIncompleteVaultDirs(fs, vaultsRootPath);
    return options.create();
  });
}

/** Persist `active_vault_id` the same way switchVault does (settings file). */
export async function persistActiveVaultIdSetting(
  fs: FileSystemAdapter,
  configDir: string,
  vaultId: string,
): Promise<void> {
  const current =
    (await readAppSettings(fs, configDir)) ?? createDefaultAppSettings();
  await writeAppSettings(
    fs,
    configDir,
    mergeAppSettings(current, { active_vault_id: vaultId }),
  );
}

async function acquireVaultBootstrapLock(
  fs: FileSystemAdapter,
  lockPath: string,
): Promise<void> {
  const deadline = Date.now() + BOOTSTRAP_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await fs.writeTextExclusive(lockPath, `${Date.now()}\n`);
      return;
    } catch (error) {
      if (!isExclusiveCreateConflict(error)) {
        throw error;
      }
      if (Date.now() >= deadline) {
        const detail =
          error instanceof Error ? error.message : String(error);
        throw new Error(
          `Timed out waiting for vault bootstrap lock at ${lockPath}: ${detail}`,
        );
      }
      await yieldToEventLoop(BOOTSTRAP_LOCK_POLL_MS);
    }
  }
}

function isExclusiveCreateConflict(error: unknown): boolean {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === "EEXIST"
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /EEXIST|already exists|file exists/i.test(message);
}
