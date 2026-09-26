/**
 * Tokenize title/description/tags/folder path segments for move-name overlap.
 * Lowercase; split on non-letter/digit runs (Unicode-aware via \p{L}\p{N}).
 */
export function tokenizeForFolderNameOverlap(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = text.toLowerCase();
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (token.length > 0) {
      tokens.add(token);
    }
  }
  return tokens;
}

/** Jaccard overlap of two token sets; empty∩empty → 0. */
export function tokenSetOverlap(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

export function folderPathNameTokens(folderPath: string): Set<string> {
  return tokenizeForFolderNameOverlap(folderPath.replaceAll("/", " "));
}

export function itemSignalNameTokens(input: {
  title: string;
  description: string;
  tagNames: readonly string[];
}): Set<string> {
  return tokenizeForFolderNameOverlap(
    [input.title, input.description, ...input.tagNames].join(" "),
  );
}

/** Map cosine ∈ [-1, 1] to [0, 1]. */
export function cosineToUnitInterval(cosine: number): number {
  return (cosine + 1) / 2;
}

export const FOLDER_MOVE_CENTROID_WEIGHT = 0.7;
export const FOLDER_MOVE_NAME_WEIGHT = 0.3;

export function hybridFolderMoveScore(input: {
  centroidUnit: number | null;
  nameOverlap: number;
}): number {
  const name = Math.max(0, Math.min(1, input.nameOverlap));
  if (input.centroidUnit === null) {
    return name;
  }
  const centroid = Math.max(0, Math.min(1, input.centroidUnit));
  return (
    FOLDER_MOVE_CENTROID_WEIGHT * centroid + FOLDER_MOVE_NAME_WEIGHT * name
  );
}
