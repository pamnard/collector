/**
 * One-shot: convert `*.media/` sidecars → shared `media/<noteUuid>/` (#281).
 *
 * Distinct from `scripts/migrate-vault-layout.mjs` / `schema-migrate.ts`
 * (those only handle legacy `items/<uuid>/` → tree layout).
 *
 * Not part of app open/sync. Not wired into #277 vault-layout-guard remediate.
 *
 * Safety:
 *   1) preflight (no writes)
 *   2) full sibling backup (unless --dry-run or --no-backup)
 *   3) migrate (resume-safe / idempotent)
 *
 * Usage:
 *   npm run build --workspace @collector/core
 *   node scripts/migrate-sidecar-media.mjs <vault-path>
 *   node scripts/migrate-sidecar-media.mjs <vault-path> --dry-run
 *   node scripts/migrate-sidecar-media.mjs <vault-path> --no-backup
 */
import { cp, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { NodeFileSystemAdapter } from "../packages/core/dist/adapters/node-fs.js";
import {
  migrateSidecarMediaToShared,
  preflightSidecarMediaMigrate,
} from "../packages/core/dist/vault/sidecar-media-migrate.js";

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
  const label = progress.path ? ` ${progress.path}` : "";
  return `[${progress.phase}] ${progress.current}/${progress.total}${label}`;
}

const { vaultArg, dryRun, noBackup } = parseArgs(process.argv.slice(2));
if (!vaultArg) {
  console.error(
    "Usage: node scripts/migrate-sidecar-media.mjs <vault-path> [--dry-run] [--no-backup]",
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

console.error("Preflight…");
const preflight = await preflightSidecarMediaMigrate(fs, vaultPath, (p) => {
  if (p.current === 1 || p.current === p.total || p.current % 50 === 0) {
    console.error(progressLine(p));
  }
});

console.error(
  `Preflight: ${preflight.sidecarCount} sidecar dir(s), ` +
    `${preflight.pairedSidecars.length} paired, ` +
    `${preflight.orphanSidecars.length} orphan(s), ` +
    `${preflight.rootMarkdown.length} root markdown.`,
);

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: true,
        ...preflight,
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
  const vaultsDir = dirname(vaultPath);
  const dataDir = dirname(vaultsDir);
  const backupRoot =
    basename(vaultsDir) === "vaults"
      ? resolve(dataDir, "vault-layout-backups")
      : resolve(vaultsDir, "vault-layout-backups");
  backupPath = resolve(
    backupRoot,
    `${basename(vaultPath)}.pre-sidecar-media-migrate-${stamp}`,
  );
  console.error(`Backup → ${backupPath}`);
  await mkdir(backupRoot, { recursive: true });
  await cp(vaultPath, backupPath, { recursive: true, verbatimSymlinks: true });
  console.error("Backup done.");
} else {
  console.error("Skipping backup (--no-backup).");
}

console.error("Migrating…");
const report = await migrateSidecarMediaToShared(fs, vaultPath, (p) => {
  if (p.current === 1 || p.current === p.total || p.current % 50 === 0) {
    console.error(progressLine(p));
  }
});

console.log(
  JSON.stringify(
    {
      ok: true,
      sidecarsMigrated: report.sidecarsMigrated,
      filesMoved: report.filesMoved,
      notesRenamedToUuid: report.notesRenamedToUuid,
      orphans: report.orphans,
      layout: report.layout,
      backupPath,
    },
    null,
    2,
  ),
);
