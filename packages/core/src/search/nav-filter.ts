export type NavSearchFilter =
  | "all"
  | "favorite"
  | "archived"
  | { type: "tag"; tagId: string };

export function navFilterFromSetting(
  filter: "all" | "favorite" | "archived" | { type: "tag"; tag_id: string },
): NavSearchFilter {
  if (typeof filter === "string") {
    return filter;
  }
  return { type: "tag", tagId: filter.tag_id };
}

export function navFilterToSetting(
  filter: NavSearchFilter,
): "all" | "favorite" | "archived" | { type: "tag"; tag_id: string } {
  if (typeof filter === "object") {
    return { type: "tag", tag_id: filter.tagId };
  }
  return filter;
}
