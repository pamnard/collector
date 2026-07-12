export type NavSearchFilter =
  | "all"
  | "favorite"
  | "archived"
  | { type: "tag"; tagId: string }
  | { type: "folder"; folderPath: string };

export function navFilterFromSetting(
  filter:
    | "all"
    | "favorite"
    | "archived"
    | { type: "tag"; tag_id: string }
    | { type: "folder"; folder_path: string },
): NavSearchFilter {
  if (typeof filter === "string") {
    return filter;
  }
  if (filter.type === "tag") {
    return { type: "tag", tagId: filter.tag_id };
  }
  return { type: "folder", folderPath: filter.folder_path };
}

export function navFilterToSetting(
  filter: NavSearchFilter,
):
  | "all"
  | "favorite"
  | "archived"
  | { type: "tag"; tag_id: string }
  | { type: "folder"; folder_path: string } {
  if (typeof filter === "object" && filter.type === "tag") {
    return { type: "tag", tag_id: filter.tagId };
  }
  if (typeof filter === "object" && filter.type === "folder") {
    return { type: "folder", folder_path: filter.folderPath };
  }
  return filter;
}

export function isFolderFilter(
  filter: NavSearchFilter,
): filter is { type: "folder"; folderPath: string } {
  return typeof filter === "object" && filter.type === "folder";
}

export function isTagFilter(
  filter: NavSearchFilter,
): filter is { type: "tag"; tagId: string } {
  return typeof filter === "object" && filter.type === "tag";
}
