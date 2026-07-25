import {
  INBOX_FOLDER_NAME,
  resolveInboxFolderName,
} from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { createId } from "../util/ids.js";
import {
  isMarkdownItemFile,
  isReservedVaultEntry,
  itemMarkdownPath,
  itemMediaRoot,
  joinSegments,
} from "./paths.js";

async function listTopLevelFolderNames(
  ctx: VaultContext,
  vaultPath: string,
): Promise<string[]> {
  const entries = await ctx.fs.readDir(vaultPath);
  const folders: string[] = [];
  for (const name of entries) {
    if (name.startsWith(".") || isReservedVaultEntry(name)) {
      continue;
    }
    if (isMarkdownItemFile(name)) {
      continue;
    }
    folders.push(name);
  }
  return folders;
}

/** Find Inbox among top-level folders, or create canonical `Inbox`. */
export async function resolveOrCreateInboxFolder(
  ctx: VaultContext,
  vaultPath: string,
): Promise<string> {
  const folders = await listTopLevelFolderNames(ctx, vaultPath);
  const existing = resolveInboxFolderName(folders);
  if (existing) {
    return existing;
  }
  await ctx.fs.mkdir(joinSegments(vaultPath, INBOX_FOLDER_NAME));
  await ctx.fs.touch(vaultPath);
  return INBOX_FOLDER_NAME;
}

/**
 * Ensure Inbox exists and no item `.md` files remain at vault root.
 * Call before index sync. Returns the on-disk Inbox folder name.
 */
export async function ensureInboxLayout(
  ctx: VaultContext,
  vaultPath: string,
): Promise<string> {
  const inbox = await resolveOrCreateInboxFolder(ctx, vaultPath);
  const entries = await ctx.fs.readDir(vaultPath);
  const rootMarkdown: string[] = [];
  for (const name of entries) {
    if (name.startsWith(".") || isReservedVaultEntry(name)) {
      continue;
    }
    if (isMarkdownItemFile(name)) {
      rootMarkdown.push(name);
    }
  }

  for (const name of rootMarkdown) {
    let destRel = `${inbox}/${name}`;
    if (await ctx.fs.exists(itemMarkdownPath(vaultPath, destRel))) {
      destRel = `${inbox}/${createId()}.md`;
    }

    await ctx.fs.rename(
      itemMarkdownPath(vaultPath, name),
      itemMarkdownPath(vaultPath, destRel),
    );

    const fromMedia = itemMediaRoot(vaultPath, name);
    if (await ctx.fs.exists(fromMedia)) {
      await ctx.fs.rename(fromMedia, itemMediaRoot(vaultPath, destRel));
    }
  }

  if (rootMarkdown.length > 0) {
    await ctx.fs.touch(vaultPath);
  }
  return inbox;
}
