const FTS_SPECIAL_CHARS = /["*:]/g;

export function buildFtsMatchQuery(userQuery: string): string | null {
  const terms = userQuery
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(FTS_SPECIAL_CHARS, "").trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return null;
  }

  return terms.map((term) => `"${term}"*`).join(" ");
}
