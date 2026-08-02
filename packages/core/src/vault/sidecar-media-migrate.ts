/**
 * One-shot converter (#281): `*.media/` sidecars → `media/<noteUuid>/`.
 * External CLI only — not wired into #277 remediate / app open-sync.
 * Distinct from schema-migrate (`items/<uuid>/` → tree).
 */
import type { FileSystemAdapter } from "../adapters/types.js";
import { createId } from "../util/ids.js";
import {
  basename,
  dirname,
  isMarkdownItemFile,
  isReservedVaultEntry,
  isUuidMarkdownBasename,
  itemMarkdownPath,
  ITEM_MEDIA_SUFFIX,
  joinSegments,
  normalizeRelativePath,
  noteSharedMediaRoot,
  VAULT_DIRS,
} from "./paths.js";
import {
  remediateVaultLayout,
  type VaultLayoutRemediateReport,
} from "./vault-layout-guard.js";

export interface SidecarMediaMigrateProgress {
  phase: "scan" | "migrate" | "layout";
  current: number;
  total: number;
  path?: string;
}

export interface SidecarMediaMigratePreflight {
  sidecarCount: number;
  pairedSidecars: string[];
  orphanSidecars: string[];
  rootMarkdown: string[];
}

export interface SidecarMediaMigrateReport {
  sidecarsMigrated: number;
  filesMoved: number;
  notesRenamedToUuid: number;
  orphans: string[];
  layout: VaultLayoutRemediateReport;
}

type ProgressCb = (progress: SidecarMediaMigrateProgress) => void;

function isSidecarDirName(name: string): boolean {
  return name.endsWith(ITEM_MEDIA_SUFFIX) && name !== ITEM_MEDIA_SUFFIX;
}

function sidecarStem(dirName: string): string {
  return dirName.slice(0, -ITEM_MEDIA_SUFFIX.length);
}

async function allocateUuidMarkdownName(
  fs: FileSystemAdapter,
  vaultPath: string,
  folderPath: string,
): Promise<string> {
  for (;;) {
    const fileName = `${createId()}.md`;
    const rel = folderPath ? `${folderPath}/${fileName}` : fileName;
    if (!(await fs.exists(itemMarkdownPath(vaultPath, rel)))) {
      return fileName;
    }
  }
}

/**
 * Walk vault for `*.media` dirs. Skips shared `media/` root and other reserved
 * entries that are not sidecar dirs.
 */
async function collectSidecarDirs(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<string[]> {
  const found: string[] = [];

  async function walk(relDir: string): Promise<void> {
    const absDir = relDir ? joinSegments(vaultPath, relDir) : vaultPath;
    if (!(await fs.exists(absDir))) {
      return;
    }
    const entries = await fs.readDirEntries(absDir);
    for (const entry of entries) {
      const { name } = entry;
      if (name.startsWith(".")) {
        continue;
      }
      const rel = relDir ? `${relDir}/${name}` : name;
      if (!entry.isDirectory) {
        continue;
      }
      if (isSidecarDirName(name)) {
        found.push(normalizeRelativePath(rel));
        continue;
      }
      // Do not descend into shared media/ or legacy reserved non-sidecar dirs.
      if (name === VAULT_DIRS.media || isReservedVaultEntry(name)) {
        continue;
      }
      await walk(rel);
    }
  }

  await walk("");
  return found;
}

async function listFilesRecursive(
  fs: FileSystemAdapter,
  absRoot: string,
  relPrefix = "",
): Promise<string[]> {
  const out: string[] = [];
  if (!(await fs.exists(absRoot))) {
    return out;
  }
  const entries = await fs.readDirEntries(absRoot);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const abs = joinSegments(absRoot, entry.name);
    if (entry.isDirectory) {
      out.push(...(await listFilesRecursive(fs, abs, rel)));
    } else {
      out.push(normalizeRelativePath(rel));
    }
  }
  return out;
}

async function uniqueDestName(
  fs: FileSystemAdapter,
  destDir: string,
  fileName: string,
): Promise<string> {
  const candidate = joinSegments(destDir, fileName);
  if (!(await fs.exists(candidate))) {
    return fileName;
  }
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let n = 2; n < 10_000; n += 1) {
    const next = `${stem} (${n})${ext}`;
    if (!(await fs.exists(joinSegments(destDir, next)))) {
      return next;
    }
  }
  throw new Error(`Could not allocate unique name under ${destDir} for ${fileName}`);
}

async function collectRootMarkdown(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<string[]> {
  const rootMarkdown: string[] = [];
  if (!(await fs.exists(vaultPath))) {
    return rootMarkdown;
  }
  const entries = await fs.readDirEntries(vaultPath);
  for (const entry of entries) {
    if (entry.isDirectory || entry.name.startsWith(".")) {
      continue;
    }
    if (isMarkdownItemFile(entry.name)) {
      rootMarkdown.push(entry.name);
    }
  }
  return rootMarkdown;
}

export async function preflightSidecarMediaMigrate(
  fs: FileSystemAdapter,
  vaultPath: string,
  onProgress?: ProgressCb,
): Promise<SidecarMediaMigratePreflight> {
  const sidecars = await collectSidecarDirs(fs, vaultPath);
  const pairedSidecars: string[] = [];
  const orphanSidecars: string[] = [];

  let i = 0;
  for (const relSidecar of sidecars) {
    i += 1;
    onProgress?.({
      phase: "scan",
      current: i,
      total: sidecars.length,
      path: relSidecar,
    });
    const dirName = basename(relSidecar);
    const stem = sidecarStem(dirName);
    const parent = dirname(relSidecar);
    const mdRel = parent ? `${parent}/${stem}.md` : `${stem}.md`;
    if (await fs.exists(itemMarkdownPath(vaultPath, mdRel))) {
      pairedSidecars.push(relSidecar);
    } else {
      orphanSidecars.push(relSidecar);
    }
  }

  return {
    sidecarCount: sidecars.length,
    pairedSidecars,
    orphanSidecars,
    rootMarkdown: await collectRootMarkdown(fs, vaultPath),
  };
}

/**
 * Migrate paired `*.media/` → `media/<noteUuid>/`, then run layout remediate
 * (root → Inbox, uuid basenames). Orphan sidecars are left in place.
 */
export async function migrateSidecarMediaToShared(
  fs: FileSystemAdapter,
  vaultPath: string,
  onProgress?: ProgressCb,
): Promise<SidecarMediaMigrateReport> {
  const preflight = await preflightSidecarMediaMigrate(fs, vaultPath, onProgress);
  let sidecarsMigrated = 0;
  let filesMoved = 0;
  let notesRenamedToUuid = 0;
  const orphans = [...preflight.orphanSidecars];

  const paired = preflight.pairedSidecars;
  let current = 0;
  for (const relSidecar of paired) {
    current += 1;
    onProgress?.({
      phase: "migrate",
      current,
      total: paired.length,
      path: relSidecar,
    });

    if (!(await fs.exists(joinSegments(vaultPath, relSidecar)))) {
      continue;
    }

    const dirName = basename(relSidecar);
    const stem = sidecarStem(dirName);
    const parent = dirname(relSidecar);
    const mdRel = parent ? `${parent}/${stem}.md` : `${stem}.md`;
    const mdAbs = itemMarkdownPath(vaultPath, mdRel);
    if (!(await fs.exists(mdAbs))) {
      orphans.push(relSidecar);
      continue;
    }

    let noteUuid = stem;
    let sidecarRel = relSidecar;

    if (!isUuidMarkdownBasename(`${stem}.md`)) {
      const newName = await allocateUuidMarkdownName(fs, vaultPath, parent);
      noteUuid = newName.slice(0, -3);
      const destMdRel = parent ? `${parent}/${newName}` : newName;
      const destSidecarRel = parent
        ? `${parent}/${noteUuid}${ITEM_MEDIA_SUFFIX}`
        : `${noteUuid}${ITEM_MEDIA_SUFFIX}`;

      await fs.rename(mdAbs, itemMarkdownPath(vaultPath, destMdRel));
      await fs.rename(
        joinSegments(vaultPath, sidecarRel),
        joinSegments(vaultPath, destSidecarRel),
      );
      sidecarRel = destSidecarRel;
      notesRenamedToUuid += 1;
    }

    const sharedRoot = noteSharedMediaRoot(vaultPath, noteUuid);
    await fs.mkdir(sharedRoot);

    const sidecarAbs = joinSegments(vaultPath, sidecarRel);
    const files = await listFilesRecursive(fs, sidecarAbs);
    for (const relFile of files) {
      const fromAbs = joinSegments(sidecarAbs, relFile);
      if (!(await fs.exists(fromAbs))) {
        continue;
      }
      const baseName = basename(relFile);
      const destName = await uniqueDestName(fs, sharedRoot, baseName);
      const destAbs = joinSegments(sharedRoot, destName);
      await fs.rename(fromAbs, destAbs);
      filesMoved += 1;
    }

    if (await fs.exists(sidecarAbs)) {
      await fs.remove(sidecarAbs, { recursive: true });
    }
    sidecarsMigrated += 1;
  }

  onProgress?.({ phase: "layout", current: 1, total: 1 });
  const layout = await remediateVaultLayout(fs, vaultPath);

  return {
    sidecarsMigrated,
    filesMoved,
    notesRenamedToUuid,
    orphans,
    layout,
  };
}
