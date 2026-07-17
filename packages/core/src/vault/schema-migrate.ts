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

/**
 * Move a legacy `.source.json` (item root) + `media/` dir into the new
 * `{stem}.media/` sidecar next to the destination `.md` file.
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
    await fs.rename(legacyMediaRoot, destMediaRoot);
  }

  const legacySourcePath = joinSegments(legacyItemRootPath, ITEM_FILES.source);
  if (await fs.exists(legacySourcePath)) {
    await fs.mkdir(destMediaRoot);
    await fs.rename(legacySourcePath, itemSourcePath(vaultPath, destId));
  }
}

/**
 * Migrate one legacy `items/<uuid>/` dir into the new path-as-id tree layout.
 * Idempotent: no-ops if the legacy dir is already gone.
 */
async function migrateLegacyItem(
  fs: FileSystemAdapter,
  vaultPath: string,
  uuid: string,
  vaultId: string,
): Promise<void> {
  const legacyItemRootPath = legacyItemRoot(vaultPath, uuid);
  if (!(await fs.exists(legacyItemRootPath))) {
    return;
  }

  const legacyMetaPath = legacyItemMetaPath(legacyItemRootPath);
  const legacyContentPath = legacyItemContentPath(legacyItemRootPath);

  let destId: string;

  if (await fs.exists(legacyMetaPath)) {
    const raw = JSON.parse(await fs.readText(legacyMetaPath)) as RawRecord;
    const sourceVersion = typeof raw.schema_version === "number" ? raw.schema_version : 1;
    const migratedFields = sourceVersion < 2 ? migrateItemV1ToV2(raw) : raw;
    const folderPath =
      typeof migratedFields.folder_path === "string" ? migratedFields.folder_path : "";
    destId = destinationIdFor(folderPath, uuid);

    let body = "";
    if (await fs.exists(legacyContentPath)) {
      const rawContent = await fs.readText(legacyContentPath);
      const parsedExisting = parseDocumentMarkdown(rawContent);
      // Pre-v3 content.md had no frontmatter (plain body).
      body = parsedExisting.detectedFormat ? parsedExisting.body : rawContent;
    }

    const item = itemFileSchema.parse({
      ...migratedFields,
      id: destId,
      vault_id: vaultId,
    });

    await writeItemDocument(fs, vaultPath, item, body);
    await fs.remove(legacyMetaPath);
    if (await fs.exists(legacyContentPath)) {
      await fs.remove(legacyContentPath);
    }
  } else if (await fs.exists(legacyContentPath)) {
    const rawContent = await fs.readText(legacyContentPath);
    const parsed = parseDocumentMarkdown(rawContent);
    const folderPath =
      typeof parsed.frontmatter.folder_path === "string"
        ? parsed.frontmatter.folder_path
        : "";
    destId = destinationIdFor(folderPath, uuid);
    const destAbsPath = itemMarkdownPath(vaultPath, destId);
    await fs.mkdir(vaultPath);
    await fs.rename(legacyContentPath, destAbsPath);
  } else {
    // Neither item.json nor content.md — nothing to migrate but stray files
    // (e.g. orphaned media) still need to be dropped.
    await fs.remove(legacyItemRootPath, { recursive: true });
    return;
  }

  await migrateLegacySidecars(fs, vaultPath, legacyItemRootPath, destId);
  if (await fs.exists(legacyItemRootPath)) {
    await fs.remove(legacyItemRootPath, { recursive: true });
  }
  await fs.touch(vaultPath);
}

async function migrateLegacyItems(
  fs: FileSystemAdapter,
  vaultPath: string,
  vaultId: string,
): Promise<void> {
  const legacyRoot = legacyItemsRoot(vaultPath);
  if (!(await fs.exists(legacyRoot))) {
    return;
  }

  const entries = await fs.readDir(legacyRoot);
  for (const uuid of entries) {
    if (uuid === RECONCILE_TOUCH_FILE || uuid.startsWith(".")) {
      continue;
    }
    await migrateLegacyItem(fs, vaultPath, uuid, vaultId);
  }

  const remaining = (await fs.exists(legacyRoot)) ? await fs.readDir(legacyRoot) : [];
  const leftover = remaining.filter(
    (entry) => entry !== RECONCILE_TOUCH_FILE && !entry.startsWith("."),
  );
  if (leftover.length === 0 && (await fs.exists(legacyRoot))) {
    await fs.remove(legacyRoot, { recursive: true });
  }
}

/** Create real directories for folders that had no items (legacy `folders.json` only). */
async function seedEmptyFoldersFromLegacyFile(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<void> {
  const legacyFolders = await readLegacyFoldersFile(fs, vaultPath);
  for (const folderPath of legacyFolders.paths) {
    await fs.mkdir(joinSegments(vaultPath, folderPath));
  }
  await deleteLegacyFoldersFile(fs, vaultPath);
}

export async function migrateVaultSchema(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<VaultMeta> {
  const raw = JSON.parse(await fs.readText(vaultMetaPath(vaultPath))) as RawRecord;
  const sourceVersion = typeof raw.schema_version === "number" ? raw.schema_version : 1;
  const vaultId = String(raw.id);

  await migrateLegacyItems(fs, vaultPath, vaultId);
  await seedEmptyFoldersFromLegacyFile(fs, vaultPath);

  if (sourceVersion >= SCHEMA_VERSION) {
    return vaultMetaSchema.parse(raw);
  }

  const migratedVault = migrateVaultMetaToCurrent(raw);
  const meta = vaultMetaSchema.parse(migratedVault);
  await writeVaultMeta(fs, vaultPath, meta);
  return meta;
}
