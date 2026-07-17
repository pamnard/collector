/**
 * One-shot: convert a legacy vault (`items/<uuid>/` + optional folders.json)
 * to the tree layout (path-as-id `.md` + `*.media/` sidecars).
 *
 * Not part of app startup. Safety:
 *   1) preflight (no writes) — abort if any item fails schema/parse
 *   2) full sibling backup (unless --dry-run or --no-backup)
 *   3) migrate (resume-safe per item)
 *
 * Usage:
 *   npm run build --workspace @collector/core
 *   node scripts/migrate-vault-layout.mjs <vault-path>
 *   node scripts/migrate-vault-layout.mjs <vault-path> --dry-run
 *   node scripts/migrate-vault-layout.mjs <vault-path> --no-backup
 */
import { cp, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { NodeFileSystemAdapter } from "../packages/core/dist/adapters/node-fs.js";
import {
  migrateVaultSchema,
  preflightLegacyVaultLayout,
} from "../packages/core/dist/vault/schema-migrate.js";
import { legacyItemsRoot } from "../packages/core/dist/vault/paths.js";

function parseArgs(argv) {
  const flags = new Set();
  const positionals = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      flags.add(arg);
    } else {
      positionals.push(arg);
    }
  }
  return {
    vaultArg: positionals[0],
    dryRun: flags.has("--dry-run"),
    noBackup: flags.has("--no-backup"),
  };
}

function progressLine(progress) {
  const label = progress.uuid ? ` ${progress.uuid}` : "";
  return `[${progress.phase}] ${progress.current}/${progress.total}${label}`;
}

const { vaultArg, dryRun, noBackup } = parseArgs(process.argv.slice(2));
if (!vaultArg) {
  console.error(
    "Usage: node scripts/migrate-vault-layout.mjs <vault-path> [--dry-run] [--no-backup]",
  );
  process.exit(1);
}

const vaultPath = resolve(vaultArg);
const fs = new NodeFileSystemAdapter();

if (!(await fs.exists(vaultPath))) {
  console.error(`Vault path does not exist: ${vaultPath}`);
  process.exit(1);
}

const metaPath = `${vaultPath.replace(/\\/g, "/")}/vault.meta.json`;
if (!(await fs.exists(metaPath))) {
  console.error(`Not a vault (missing vault.meta.json): ${vaultPath}`);
  process.exit(1);
}

const hadLegacy = await fs.exists(legacyItemsRoot(vaultPath));

console.error("Preflight…");
const preflight = await preflightLegacyVaultLayout(fs, vaultPath, (p) => {
  if (p.current === 1 || p.current === p.total || p.current % 50 === 0) {
    console.error(progressLine(p));
  }
});

if (preflight.issues.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        phase: "preflight",
        itemCount: preflight.itemCount,
        issueCount: preflight.issues.length,
        issues: preflight.issues,
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

console.error(
  `Preflight ok: ${preflight.itemCount} legacy item dirs (schema ${preflight.sourceSchemaVersion}).`,
);

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: true,
        vaultId: preflight.vaultId,
        sourceSchemaVersion: preflight.sourceSchemaVersion,
        itemCount: preflight.itemCount,
        hadLegacyItemsDir: hadLegacy,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

let backupPath = null;
if (!noBackup) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // Never write backups inside vaults/ — app discovers every dir with vault.meta.json.
  // Prefer sibling of vaults/: <dataDir>/vault-layout-backups/<id>.pre-layout-migrate-…
  const vaultsDir = dirname(vaultPath);
  const dataDir = dirname(vaultsDir);
  const backupRoot =
    basename(vaultsDir) === "vaults"
      ? resolve(dataDir, "vault-layout-backups")
      : resolve(vaultsDir, "vault-layout-backups");
  backupPath = resolve(
    backupRoot,
    `${basename(vaultPath)}.pre-layout-migrate-${stamp}`,
  );
  console.error(`Backup → ${backupPath}`);
  await mkdir(backupRoot, { recursive: true });
  await cp(vaultPath, backupPath, { recursive: true, verbatimSymlinks: true });
  console.error("Backup done.");
} else {
  console.error("Skipping backup (--no-backup).");
}

console.error("Migrating…");
const report = await migrateVaultSchema(fs, vaultPath, (p) => {
  if (p.current === 1 || p.current === p.total || p.current % 50 === 0) {
    console.error(progressLine(p));
  }
});

console.log(
  JSON.stringify(
    {
      ok: true,
      vaultId: report.meta.id,
      schema_version: report.meta.schema_version,
      converted_legacy_items_dir: hadLegacy,
      itemsTotal: report.itemsTotal,
      itemsMigrated: report.itemsMigrated,
      itemsSkippedGone: report.itemsSkippedGone,
      foldersSeeded: report.foldersSeeded,
      backupPath,
    },
    null,
    2,
  ),
);
