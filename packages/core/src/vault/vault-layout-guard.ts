/**
 * Background vault layout guard (#277): uuid item names, no root clutter,
 * loose non-markdown in collections → Inbox note + media/<uuid>/.
 * Does not migrate *.media/ sidecars (#281).
 */
import { INBOX_FOLDER_NAME, type ItemFile } from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { yieldToEventLoop } from "../util/concurrency.js";
import { createId, nowIso } from "../util/ids.js";
import { titleStemFromFilename } from "./drop-import-classify.js";
import { readVaultMeta, writeItemDocument } from "./item-io.js";
import {
  basename,
  dirname,
  isMarkdownItemFile,
  isReservedVaultEntry,
  isUuidMarkdownBasename,
  itemMarkdownPath,
  joinSegments,
  noteSharedMediaRoot,
  normalizeRelativePath,
} from "./paths.js";

export interface VaultLayoutInspectReport {
  ok: boolean;
  rootMarkdown: string[];
  rootLooseFiles: string[];
  looseFilesInCollections: string[];
  nonUuidMarkdown: string[];
}

export interface VaultLayoutRemediateReport {
  renamed: number;
  movedRootNotes: number;
  importedLoose: number;
}

export interface RemediateVaultLayoutOptions {
  yieldEvery?: number;
}

/** Allocate an unused `<uuid>.md` basename under `folderPath` ("" = vault root). */
export async function allocateUuidMarkdownName(
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

function shouldSkipEntryName(name: string): boolean {
  return name.startsWith(".") || isReservedVaultEntry(name);
}

/**
 * Walk collection folders (not media/, not *.media). Collect layout issues.
 */
export async function inspectVaultLayout(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<VaultLayoutInspectReport> {
  const rootMarkdown: string[] = [];
  const rootLooseFiles: string[] = [];
  const looseFilesInCollections: string[] = [];
  const nonUuidMarkdown: string[] = [];

  if (!(await fs.exists(vaultPath))) {
    return {
      ok: true,
      rootMarkdown,
      rootLooseFiles,
      looseFilesInCollections,
      nonUuidMarkdown,
    };
  }

  const rootEntries = await fs.readDirEntries(vaultPath);
  for (const entry of rootEntries) {
    const { name } = entry;
    if (shouldSkipEntryName(name)) {
      continue;
    }
    if (!entry.isDirectory) {
      if (isMarkdownItemFile(name)) {
        rootMarkdown.push(name);
        if (!isUuidMarkdownBasename(name)) {
          nonUuidMarkdown.push(name);
        }
      } else {
        rootLooseFiles.push(name);
      }
      continue;
    }
    await walkCollectionDir(
      fs,
      vaultPath,
      name,
      looseFilesInCollections,
      nonUuidMarkdown,
    );
  }

  const ok =
    rootMarkdown.length === 0 &&
    rootLooseFiles.length === 0 &&
    looseFilesInCollections.length === 0 &&
    nonUuidMarkdown.length === 0;

  return {
    ok,
    rootMarkdown,
    rootLooseFiles,
    looseFilesInCollections,
    nonUuidMarkdown,
  };
}

async function walkCollectionDir(
  fs: FileSystemAdapter,
  vaultPath: string,
  relDir: string,
  looseFilesInCollections: string[],
  nonUuidMarkdown: string[],
): Promise<void> {
  const absDir = joinSegments(vaultPath, relDir);
  const entries = await fs.readDirEntries(absDir);
  for (const entry of entries) {
    const { name } = entry;
    if (shouldSkipEntryName(name)) {
      continue;
    }
    const rel = `${relDir}/${name}`;
    if (entry.isDirectory) {
      await walkCollectionDir(
        fs,
        vaultPath,
        rel,
        looseFilesInCollections,
        nonUuidMarkdown,
      );
      continue;
    }
    if (isMarkdownItemFile(name)) {
      if (!isUuidMarkdownBasename(name)) {
        nonUuidMarkdown.push(rel);
      }
      continue;
    }
    looseFilesInCollections.push(rel);
  }
}

export async function remediateVaultLayout(
  fs: FileSystemAdapter,
  vaultPath: string,
  options: RemediateVaultLayoutOptions = {},
): Promise<VaultLayoutRemediateReport> {
  const yieldEvery = options.yieldEvery ?? 8;
  let renamed = 0;
  let movedRootNotes = 0;
  let importedLoose = 0;
  let ops = 0;

  const maybeYield = async () => {
    ops += 1;
    if (ops % yieldEvery === 0) {
      await yieldToEventLoop();
    }
  };

  await fs.mkdir(joinSegments(vaultPath, INBOX_FOLDER_NAME));

  const vaultMeta = await readVaultMeta(fs, vaultPath);
  const vaultId = vaultMeta.id;

  // Fresh inspect each phase so resume-safe renames see current tree.
  let report = await inspectVaultLayout(fs, vaultPath);

  // 1) Rename non-uuid markdown in place (including root — root move is step 2).
  for (const rel of [...report.nonUuidMarkdown]) {
    if (!(await fs.exists(itemMarkdownPath(vaultPath, rel)))) {
      continue;
    }
    const folder = dirname(rel);
    // Root non-uuid notes: only rename stem here if we will move in step 2;
    // allocate uuid name in same folder first.
    const newName = await allocateUuidMarkdownName(fs, vaultPath, folder);
    const destRel = folder ? `${folder}/${newName}` : newName;
    if (normalizeRelativePath(rel) === normalizeRelativePath(destRel)) {
      continue;
    }
    await fs.rename(
      itemMarkdownPath(vaultPath, rel),
      itemMarkdownPath(vaultPath, destRel),
    );
    renamed += 1;
    await maybeYield();
  }

  report = await inspectVaultLayout(fs, vaultPath);

  // 2) Move root markdown into Inbox (uuid name).
  for (const name of [...report.rootMarkdown]) {
    const fromAbs = itemMarkdownPath(vaultPath, name);
    if (!(await fs.exists(fromAbs))) {
      continue;
    }
    const stemOk = isUuidMarkdownBasename(name);
    const destName = stemOk
      ? name
      : await allocateUuidMarkdownName(fs, vaultPath, INBOX_FOLDER_NAME);
    let destRel = `${INBOX_FOLDER_NAME}/${destName}`;
    if (await fs.exists(itemMarkdownPath(vaultPath, destRel))) {
      const collisionName = await allocateUuidMarkdownName(
        fs,
        vaultPath,
        INBOX_FOLDER_NAME,
      );
      destRel = `${INBOX_FOLDER_NAME}/${collisionName}`;
    }
    await fs.rename(fromAbs, itemMarkdownPath(vaultPath, destRel));
    movedRootNotes += 1;
    if (!stemOk) {
      renamed += 1;
    }
    await maybeYield();
  }

  report = await inspectVaultLayout(fs, vaultPath);

  // 3) Import loose files (root + collections) → Inbox/<uuid>.md + media/<uuid>/.
  const loose = [
    ...report.rootLooseFiles,
    ...report.looseFilesInCollections,
  ];
  for (const rel of loose) {
    const fromAbs = joinSegments(vaultPath, normalizeRelativePath(rel));
    if (!(await fs.exists(fromAbs))) {
      continue;
    }
    const noteUuid = createId();
    const destRel = `${INBOX_FOLDER_NAME}/${noteUuid}.md`;
    if (await fs.exists(itemMarkdownPath(vaultPath, destRel))) {
      continue;
    }
    const fileBase = basename(rel);
    const title = titleStemFromFilename(fileBase);
    const now = nowIso();
    const item: ItemFile = {
      id: destRel,
      vault_id: vaultId,
      title,
      description: "",
      content_type: "note",
      source_type: "manual",
      metadata: {},
      properties: {},
      tag_ids: [],
      collection_ids: [],
      folder_path: INBOX_FOLDER_NAME,
      content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: now,
      updated_at: now,
    };
    await writeItemDocument(fs, vaultPath, item, "");

    const mediaRoot = noteSharedMediaRoot(vaultPath, noteUuid);
    await fs.mkdir(mediaRoot);
    const destFile = joinSegments(mediaRoot, fileBase);
    if (await fs.exists(destFile)) {
      await fs.remove(destFile);
    }
    await fs.rename(fromAbs, destFile);
    importedLoose += 1;
    await maybeYield();
  }

  return { renamed, movedRootNotes, importedLoose };
}
