import { z } from "zod";

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
