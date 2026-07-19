/**
 * Migrate legacy host-unified settings/index into the canonical profile layout (#238).
 *
 * Legacy host put `config/` + `collector.db` under `dataDir`. Production Tauri keeps
 * settings/index under `appConfigDir`. When those diverge, copy missing targets from
 * the legacy locations without touching vault files. Index is disposable — prefer an
 * existing destination DB over overwriting it.
 */

import {
  APP_SETTINGS_FILE,
  COLLECTOR_INDEX_DB_FILE,
  COLLECTOR_SELF_CONTAINED_CONFIG_DIR,
  parentDir,
  type CollectorProfileLayout,
} from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { joinSegments } from "../vault/paths.js";

export interface ProfileLayoutMigrationResult {
  settingsMigrated: boolean;
  indexMigrated: boolean;
}

function legacyUnifiedConfigDir(dataDir: string): string {
  return joinSegments(dataDir, COLLECTOR_SELF_CONTAINED_CONFIG_DIR);
}

function legacyUnifiedIndexDb(dataDir: string): string {
  return joinSegments(dataDir, COLLECTOR_INDEX_DB_FILE);
}

async function copyFileIfMissing(
  fs: FileSystemAdapter,
  source: string,
  dest: string,
): Promise<boolean> {
  if (!(await fs.exists(source))) {
    return false;
  }
  if (await fs.exists(dest)) {
    return false;
  }
  const parent = parentDir(dest);
  if (parent && parent !== dest) {
    await fs.mkdir(parent);
  }
  const bytes = await fs.readBinary(source);
  await fs.writeBinary(dest, bytes);
  return true;
}

/**
 * Repoint legacy unified host artifacts into `layout` when targets are missing.
 * No-op when `layout` is already self-contained under the same dataDir.
 */
export async function migrateLegacyUnifiedProfileLayout(
  fs: FileSystemAdapter,
  layout: CollectorProfileLayout,
): Promise<ProfileLayoutMigrationResult> {
  const legacyConfig = legacyUnifiedConfigDir(layout.dataDir);
  const legacySettings = joinSegments(legacyConfig, APP_SETTINGS_FILE);
  const targetSettings = joinSegments(layout.configDir, APP_SETTINGS_FILE);
  const legacyIndex = legacyUnifiedIndexDb(layout.dataDir);

  let settingsMigrated = false;
  let indexMigrated = false;

  if (legacyConfig !== layout.configDir) {
    settingsMigrated = await copyFileIfMissing(fs, legacySettings, targetSettings);
  }

  if (legacyIndex !== layout.indexDbPath) {
    indexMigrated = await copyFileIfMissing(fs, legacyIndex, layout.indexDbPath);
    for (const suffix of ["-wal", "-shm"] as const) {
      await copyFileIfMissing(
        fs,
        `${legacyIndex}${suffix}`,
        `${layout.indexDbPath}${suffix}`,
      );
    }
  }

  return { settingsMigrated, indexMigrated };
}
