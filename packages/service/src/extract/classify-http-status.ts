/** Shared HTTP status classification for site extract fetch layers. */

export type ExtractHttpStatusKind =
  | "ok"
  | "not_found"
  | "rate_limited"
  | "private_or_unavailable"
  | "other";

export function classifyHttpStatus(status: number): ExtractHttpStatusKind {
  if (status >= 200 && status < 300) {
    return "ok";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 401 || status === 403) {
    return "private_or_unavailable";
  }
  return "other";
}
