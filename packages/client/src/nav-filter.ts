import type { NavFilter } from "@collector/api";

export function navFilterToSetting(
  filter: NavFilter,
):
  | "all"
  | { type: "tag"; tag_id: string }
  | { type: "folder"; folder_path: string } {
  if (typeof filter === "object" && filter !== null && "type" in filter) {
    if (filter.type === "tag" && "tagId" in filter) {
      return { type: "tag", tag_id: String(filter.tagId) };
    }
    if (filter.type === "folder" && "folderPath" in filter) {
      return { type: "folder", folder_path: String(filter.folderPath) };
    }
  }
  return "all";
}
