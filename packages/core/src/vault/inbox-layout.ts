import {
  INBOX_FOLDER_NAME,
  resolveInboxFolderName,
} from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import {
  isReservedVaultEntry,
  joinSegments,
} from "./paths.js";

async function listTopLevelFolderNames(
  ctx: VaultContext,
  vaultPath: string,
): Promise<string[]> {
  const entries = await ctx.fs.readDirEntries(vaultPath);
  const folders: string[] = [];
  for (const entry of entries) {
    const { name } = entry;
    if (name.startsWith(".") || isReservedVaultEntry(name)) {
      continue;
    }
    if (!entry.isDirectory) {
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
 * Ensure the default collection folder exists (#277: root cleanup is layout-guard).
 */
export async function ensureInboxLayout(
  ctx: VaultContext,
  vaultPath: string,
): Promise<string> {
  return resolveOrCreateInboxFolder(ctx, vaultPath);
}
