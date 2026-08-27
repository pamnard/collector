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

/**
 * Applies add-tag intent. Calls `onChange` only when selection actually grows.
 * Returns whether the input should be cleared (false when blank — keep as-is).
 */
export function applyAddTagName(
  selectedTagNames: string[],
  rawName: string,
  onChange: (tagNames: string[]) => void,
): boolean {
  const next = nextSelectionAfterAdd(selectedTagNames, rawName);
  if (next === null) {
    return false;
  }
  if (next !== selectedTagNames) {
    onChange(next);
  }
  return true;
}
