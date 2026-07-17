/**
 * One-shot vault layout conversion (legacy `items/<uuid>/` → tree).
 * Used by `scripts/migrate-vault-layout.mjs` only — never from app open/sync.
 */
import {
  SCHEMA_VERSION,
  itemFileSchema,
  vaultMetaSchema,
  type VaultMeta,
} from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { parseDocumentMarkdown } from "./frontmatter.js";
import { deleteLegacyFoldersFile, readLegacyFoldersFile } from "./folder-io.js";
import { writeItemDocument, writeVaultMeta } from "./item-io.js";
import {
  ITEM_FILES,
  RECONCILE_TOUCH_FILE,
  itemMarkdownPath,
  itemMediaRoot,
  itemSourcePath,
  joinSegments,
  legacyItemContentPath,
  legacyItemMediaRoot,
  legacyItemMetaPath,
  legacyItemRoot,
  legacyItemsRoot,
  vaultMetaPath,
} from "./paths.js";

type RawRecord = Record<string, unknown>;

export interface LegacyVaultMigrateProgress {
  phase: "preflight" | "migrate" | "folders" | "meta";
  current: number;
  total: number;
  uuid?: string;
}

export interface LegacyVaultMigrateReport {
  meta: VaultMeta;
  itemsTotal: number;
  itemsMigrated: number;
  itemsSkippedGone: number;
  foldersSeeded: number;
}

export interface LegacyVaultPreflightIssue {
  uuid: string;
  message: string;
}

export interface LegacyVaultPreflightReport {
  vaultId: string;
  sourceSchemaVersion: number;
  itemCount: number;
  issues: LegacyVaultPreflightIssue[];
}

function migrateItemV1ToV2(raw: RawRecord): RawRecord {
  return {
    ...raw,
    tag_ids: raw.tag_ids ?? [],
    collection_ids: raw.collection_ids ?? [],
    folder_path: raw.folder_path ?? "",
    content_revision: raw.content_revision ?? 1,
    updated_at: new Date().toISOString(),
  };
}

function migrateVaultMetaToCurrent(raw: RawRecord): RawRecord {
  return {
    ...raw,
    settings: raw.settings ?? {},
    schema_version: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
  };
}

function destinationIdFor(folderPath: string, uuid: string): string {
  const normalized = folderPath.trim();
  return normalized ? `${normalized}/${uuid}.md` : `${uuid}.md`;
}

function prepareItemFields(raw: RawRecord): RawRecord {
  const sourceVersion = typeof raw.schema_version === "number" ? raw.schema_version : 1;
  return sourceVersion < 2 ? migrateItemV1ToV2(raw) : raw;
}

/**
 * Legacy `items/<uuid>/content.md` is plain body; metadata lives in `item.json`.
 * Never parse as frontmatter — bodies that start with `---` must stay intact.
 */
async function readLegacyBody(
  fs: FileSystemAdapter,
  legacyContentPath: string,
): Promise<string> {
  if (!(await fs.exists(legacyContentPath))) {
    return "";
  }
  return fs.readText(legacyContentPath);
}

/**
 * Move a legacy `.source.json` (item root) + `media/` dir into the new
 * `{stem}.media/` sidecar next to the destination `.md` file.
 * Resume-safe: replaces a partial destination sidecar if the legacy source still exists.
 */
async function migrateLegacySidecars(
  fs: FileSystemAdapter,
  vaultPath: string,
  legacyItemRootPath: string,
  destId: string,
): Promise<void> {
  const legacyMediaRoot = legacyItemMediaRoot(legacyItemRootPath);
  const destMediaRoot = itemMediaRoot(vaultPath, destId);

  if (await fs.exists(legacyMediaRoot)) {
    if (await fs.exists(destMediaRoot)) {
      await fs.remove(destMediaRoot, { recursive: true });
    }
    await fs.rename(legacyMediaRoot, destMediaRoot);
  }

  const legacySourcePath = joinSegments(legacyItemRootPath, ITEM_FILES.source);
  if (await fs.exists(legacySourcePath)) {
    await fs.mkdir(destMediaRoot);
    const destSource = itemSourcePath(vaultPath, destId);
    if (await fs.exists(destSource)) {
      await fs.remove(destSource);
    }
    await fs.rename(legacySourcePath, destSource);
  }
}

function buildItemFromLegacyMeta(
  raw: RawRecord,
  destId: string,
  vaultId: string,
): ReturnType<typeof itemFileSchema.parse> {
  const migratedFields = prepareItemFields(raw);
  return itemFileSchema.parse({
    ...migratedFields,
    id: destId,
    vault_id: vaultId,
  });
}

/**
 * Migrate one legacy `items/<uuid>/` dir into the new path-as-id tree layout.
 * Idempotent: no-ops if the legacy dir is already gone.
 * Resume-safe if a previous run wrote the `.md` / sidecars but left the legacy dir.
 */
async function migrateLegacyItem(
  fs: FileSystemAdapter,
  vaultPath: string,
  uuid: string,
  vaultId: string,
): Promise<"migrated" | "skipped"> {
  const legacyItemRootPath = legacyItemRoot(vaultPath, uuid);
  if (!(await fs.exists(legacyItemRootPath))) {
    return "skipped";
  }

  const legacyMetaPath = legacyItemMetaPath(legacyItemRootPath);
  const legacyContentPath = legacyItemContentPath(legacyItemRootPath);

  let destId: string;

  if (await fs.exists(legacyMetaPath)) {
    const raw = JSON.parse(await fs.readText(legacyMetaPath)) as RawRecord;
    const migratedFields = prepareItemFields(raw);
    const folderPath =
      typeof migratedFields.folder_path === "string" ? migratedFields.folder_path : "";
    destId = destinationIdFor(folderPath, uuid);

    const body = await readLegacyBody(fs, legacyContentPath);
    const item = buildItemFromLegacyMeta(raw, destId, vaultId);

    await writeItemDocument(fs, vaultPath, item, body);
    await fs.remove(legacyMetaPath);
    if (await fs.exists(legacyContentPath)) {
      await fs.remove(legacyContentPath);
    }
  } else if (await fs.exists(legacyContentPath)) {
    // Rare: content-only legacy dir (no item.json). Keep FM parse here.
    const rawContent = await fs.readText(legacyContentPath);
    const parsed = parseDocumentMarkdown(rawContent);
    const folderPath =
      typeof parsed.frontmatter.folder_path === "string"
        ? parsed.frontmatter.folder_path
        : "";
    destId = destinationIdFor(folderPath, uuid);
    const destAbsPath = itemMarkdownPath(vaultPath, destId);
    if (await fs.exists(destAbsPath)) {
      await fs.remove(destAbsPath);
    }
    await fs.mkdir(vaultPath);
    await fs.rename(legacyContentPath, destAbsPath);
  } else {
    // Neither item.json nor content.md — nothing to migrate but stray files
    // (e.g. orphaned media) still need to be dropped.
    await fs.remove(legacyItemRootPath, { recursive: true });
    return "migrated";
  }

  await migrateLegacySidecars(fs, vaultPath, legacyItemRootPath, destId);
  if (await fs.exists(legacyItemRootPath)) {
    await fs.remove(legacyItemRootPath, { recursive: true });
  }
  await fs.touch(vaultPath);
  return "migrated";
}

async function listLegacyItemUuids(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<string[]> {
  const legacyRoot = legacyItemsRoot(vaultPath);
  if (!(await fs.exists(legacyRoot))) {
    return [];
  }
  const entries = await fs.readDir(legacyRoot);
  return entries.filter(
    (entry) => entry !== RECONCILE_TOUCH_FILE && !entry.startsWith("."),
  );
}

/**
 * Validate every legacy item can be converted — no disk writes.
 * Collects per-item Zod/parse failures so the operator sees the full set.
 */
export async function preflightLegacyVaultLayout(
  fs: FileSystemAdapter,
  vaultPath: string,
  onProgress?: (progress: LegacyVaultMigrateProgress) => void,
): Promise<LegacyVaultPreflightReport> {
  const raw = JSON.parse(await fs.readText(vaultMetaPath(vaultPath))) as RawRecord;
  const vaultId = String(raw.id);
  const sourceSchemaVersion =
    typeof raw.schema_version === "number" ? raw.schema_version : 1;
  const uuids = await listLegacyItemUuids(fs, vaultPath);
  const issues: LegacyVaultPreflightIssue[] = [];

  for (let i = 0; i < uuids.length; i++) {
    const uuid = uuids[i]!;
    onProgress?.({
      phase: "preflight",
      current: i + 1,
      total: uuids.length,
      uuid,
    });

    try {
      const legacyItemRootPath = legacyItemRoot(vaultPath, uuid);
      const legacyMetaPath = legacyItemMetaPath(legacyItemRootPath);
      const legacyContentPath = legacyItemContentPath(legacyItemRootPath);

      if (!(await fs.exists(legacyMetaPath))) {
        if (!(await fs.exists(legacyContentPath))) {
          continue;
        }
        const rawContent = await fs.readText(legacyContentPath);
        parseDocumentMarkdown(rawContent);
        continue;
      }

      const itemRaw = JSON.parse(await fs.readText(legacyMetaPath)) as RawRecord;
      const migratedFields = prepareItemFields(itemRaw);
      const folderPath =
        typeof migratedFields.folder_path === "string" ? migratedFields.folder_path : "";
      const destId = destinationIdFor(folderPath, uuid);
      buildItemFromLegacyMeta(itemRaw, destId, vaultId);
      if (await fs.exists(legacyContentPath)) {
        await fs.readText(legacyContentPath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ uuid, message });
    }
  }

  return {
    vaultId,
    sourceSchemaVersion,
    itemCount: uuids.length,
    issues,
  };
}

async function migrateLegacyItems(
  fs: FileSystemAdapter,
  vaultPath: string,
  vaultId: string,
  onProgress?: (progress: LegacyVaultMigrateProgress) => void,
): Promise<{ migrated: number; skipped: number; total: number }> {
  const legacyRoot = legacyItemsRoot(vaultPath);
  if (!(await fs.exists(legacyRoot))) {
    return { migrated: 0, skipped: 0, total: 0 };
  }

  const uuids = await listLegacyItemUuids(fs, vaultPath);
  let migrated = 0;
  let skipped = 0;

  for (let i = 0; i < uuids.length; i++) {
    const uuid = uuids[i]!;
    onProgress?.({
      phase: "migrate",
      current: i + 1,
      total: uuids.length,
      uuid,
    });
    const result = await migrateLegacyItem(fs, vaultPath, uuid, vaultId);
    if (result === "migrated") {
      migrated += 1;
    } else {
      skipped += 1;
    }
  }

  const remaining = (await fs.exists(legacyRoot)) ? await fs.readDir(legacyRoot) : [];
  const leftover = remaining.filter(
    (entry) => entry !== RECONCILE_TOUCH_FILE && !entry.startsWith("."),
  );
  if (leftover.length === 0 && (await fs.exists(legacyRoot))) {
    await fs.remove(legacyRoot, { recursive: true });
  }

  return { migrated, skipped, total: uuids.length };
}

/** Create real directories for folders that had no items (legacy `folders.json` only). */
async function seedEmptyFoldersFromLegacyFile(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<number> {
  const legacyFolders = await readLegacyFoldersFile(fs, vaultPath);
  for (const folderPath of legacyFolders.paths) {
    await fs.mkdir(joinSegments(vaultPath, folderPath));
  }
  const count = legacyFolders.paths.length;
  await deleteLegacyFoldersFile(fs, vaultPath);
  return count;
}

export async function migrateVaultSchema(
  fs: FileSystemAdapter,
  vaultPath: string,
  onProgress?: (progress: LegacyVaultMigrateProgress) => void,
): Promise<LegacyVaultMigrateReport> {
  const raw = JSON.parse(await fs.readText(vaultMetaPath(vaultPath))) as RawRecord;
  const sourceVersion = typeof raw.schema_version === "number" ? raw.schema_version : 1;
  const vaultId = String(raw.id);

  const itemStats = await migrateLegacyItems(fs, vaultPath, vaultId, onProgress);

  onProgress?.({ phase: "folders", current: 1, total: 1 });
  const foldersSeeded = await seedEmptyFoldersFromLegacyFile(fs, vaultPath);

  onProgress?.({ phase: "meta", current: 1, total: 1 });
  if (sourceVersion >= SCHEMA_VERSION) {
    return {
      meta: vaultMetaSchema.parse(raw),
      itemsTotal: itemStats.total,
      itemsMigrated: itemStats.migrated,
      itemsSkippedGone: itemStats.skipped,
      foldersSeeded,
    };
  }

  const migratedVault = migrateVaultMetaToCurrent(raw);
  const meta = vaultMetaSchema.parse(migratedVault);
  await writeVaultMeta(fs, vaultPath, meta);
  return {
    meta,
    itemsTotal: itemStats.total,
    itemsMigrated: itemStats.migrated,
    itemsSkippedGone: itemStats.skipped,
    foldersSeeded,
  };
}
