import type { TagWithCount } from "@collector/core";

export function sameTagName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Known catalog names first, then selected names not yet in the catalog. */
export function buildTagDisplayNames(
  knownNames: string[],
  selectedTagNames: string[],
): string[] {
  const pending = selectedTagNames.filter(
    (name) => !knownNames.some((knownName) => sameTagName(knownName, name)),
  );
  return [...knownNames, ...pending];
}

export function toggleTagSelection(
  selectedTagNames: string[],
  name: string,
): string[] {
  if (selectedTagNames.some((selected) => sameTagName(selected, name))) {
    return selectedTagNames.filter((selected) => !sameTagName(selected, name));
  }
  return [...selectedTagNames, name.trim()];
}

/** Returns null when the trimmed name is empty (caller keeps input as-is). */
export function nextSelectionAfterAdd(
  selectedTagNames: string[],
  rawName: string,
): string[] | null {
  const name = rawName.trim();
  if (!name) {
    return null;
  }
  if (selectedTagNames.some((selected) => sameTagName(selected, name))) {
    return selectedTagNames;
  }
  return [...selectedTagNames, name];
}

export function removeTagFromSelection(
  selectedTagNames: string[],
  tagName: string,
): string[] {
  return selectedTagNames.filter(
    (selected) => !sameTagName(selected, tagName),
  );
}

export function renameTagInSelection(
  selectedTagNames: string[],
  fromName: string,
  toName: string,
): string[] {
  return selectedTagNames.map((selected) =>
    sameTagName(selected, fromName) ? toName : selected,
  );
}

export function applyTagRecordUpdate(
  tags: TagWithCount[],
  tagId: string,
  updated: Pick<TagWithCount, "id" | "name" | "color" | "created_at">,
): TagWithCount[] {
  return tags
    .map((entry) =>
      entry.id === tagId
        ? { ...entry, ...updated, item_count: entry.item_count }
        : entry,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function removeTagFromCatalog(
  tags: TagWithCount[],
  tagId: string,
): TagWithCount[] {
  return tags.filter((entry) => entry.id !== tagId);
}
