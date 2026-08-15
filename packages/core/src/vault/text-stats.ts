/**
 * Derived text stats for note body (no frontmatter).
 * Stored in the SQL index for sort / top-N; not written to on-disk YAML.
 */

export interface TextStats {
  wordCount: number;
  characterCount: number;
}

/** One or more Unicode letters (with optional combining marks between). */
const WORD_RE = /\p{L}[\p{L}\p{M}]*/gu;

/** Count words and Unicode code points in markdown body only. */
export function countTextStats(body: string): TextStats {
  let characterCount = 0;
  for (const _ of body) {
    characterCount += 1;
  }
  let wordCount = 0;
  WORD_RE.lastIndex = 0;
  while (WORD_RE.exec(body) !== null) {
    wordCount += 1;
  }
  return { wordCount, characterCount };
}
