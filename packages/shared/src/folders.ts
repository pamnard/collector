import { z } from "zod";

/** Canonical on-disk name for the default landing collection. */
export const INBOX_FOLDER_NAME = "Inbox";

export function isInboxFolderName(name: string): boolean {
  return name.toLowerCase() === INBOX_FOLDER_NAME.toLowerCase();
}

/** Inbox first, then localeCompare — for sidebar / picker / tree roots. */
export function compareFolderNamesForDisplay(a: string, b: string): number {
  const aInbox = isInboxFolderName(a);
  const bInbox = isInboxFolderName(b);
  if (aInbox !== bInbox) {
    return aInbox ? -1 : 1;
  }
  return a.localeCompare(b);
}

/**
 * Among top-level directory names, pick the Inbox folder.
 * Prefers exact `Inbox`; otherwise the first ignore-case match.
 * Does not rename on-disk casing.
 */
export function resolveInboxFolderName(topLevelNames: string[]): string | null {
  const candidates = topLevelNames.filter(isInboxFolderName);
  if (candidates.length === 0) {
    return null;
  }
  const exact = candidates.find((name) => name === INBOX_FOLDER_NAME);
  return exact ?? candidates[0]!;
}

export const foldersFileSchema = z.object({
  paths: z.array(z.string()).default([]),
});

export type FoldersFile = z.infer<typeof foldersFileSchema>;

const navFilterPrimitiveSchema = z.union([
  z.literal("all"),
  z.object({ type: z.literal("tag"), tag_id: z.string().uuid() }),
  z.object({ type: z.literal("folder"), folder_path: z.string() }),
]);

/** Accepts legacy favorite/archived settings and maps them to "all". */
export const navFilterSettingSchema = z.preprocess((value) => {
  if (value === "favorite" || value === "archived") {
    return "all";
  }
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "folder" &&
    (value as { folder_path?: unknown }).folder_path === ""
  ) {
    return "all";
  }
  return value;
}, navFilterPrimitiveSchema);

export type NavFilterSetting = z.infer<typeof navFilterSettingSchema>;

export function normalizeFolderPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export function isValidFolderPath(path: string): boolean {
  if (!path) {
    return true;
  }
  const normalized = normalizeFolderPath(path);
  return normalized === path && !path.includes("//");
}

/** Parent folder of a vault-relative item path (`a/b/note.md` → `a/b`). */
export function folderPathFromItemPath(itemPath: string): string {
  const normalized = itemPath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) {
    return "";
  }
  return normalized.slice(0, idx);
}
