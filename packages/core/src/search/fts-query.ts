const FTS_SPECIAL_CHARS = /["*:]/g;

function extractFtsTerms(userQuery: string): string[] {
  return userQuery
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(FTS_SPECIAL_CHARS, "").trim())
    .filter(Boolean);
}

export function buildFtsMatchQuery(userQuery: string): string | null {
  const terms = extractFtsTerms(userQuery);
  if (terms.length === 0) {
    return null;
  }

  return terms.map((term) => `"${term}"*`).join(" ");
}

/** Title + description only — used while Phase B (content FTS) is still running. */
export function buildMetadataFtsMatchQuery(userQuery: string): string | null {
  const terms = extractFtsTerms(userQuery);
  if (terms.length === 0) {
    return null;
  }

  return terms
    .map((term) => `(title : "${term}"* OR description : "${term}"*)`)
    .join(" ");
}
