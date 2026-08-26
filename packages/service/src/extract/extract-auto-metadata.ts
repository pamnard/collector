/**
 * One-shot auto-extract markers in item.metadata.extract_auto.
 * Keyed by shortcode — auto job skips shortcodes already present.
 */

import type { ExtractCandidate } from "@collector/api";

export const EXTRACT_AUTO_METADATA_KEY = "extract_auto";

export type ExtractAutoAttempt = {
  attempted_at: string;
  ok: boolean;
  error?: string;
};

type ExtractAutoMap = Record<string, ExtractAutoAttempt>;

/** Shortcode from candidate meta (Instagram and peers). */
export function extractAutoShortcode(
  candidate: ExtractCandidate,
): string | null {
  const raw = candidate.meta?.shortcode?.trim();
  if (!raw) {
    return null;
  }
  return raw;
}

export function readExtractAutoMap(
  metadata: Record<string, unknown> | undefined | null,
): ExtractAutoMap {
  if (!metadata) {
    return {};
  }
  const raw = metadata[EXTRACT_AUTO_METADATA_KEY];
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: ExtractAutoMap = {};
  for (const [shortcode, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!shortcode || value === null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.attempted_at !== "string" || typeof entry.ok !== "boolean") {
      continue;
    }
    const attempt: ExtractAutoAttempt = {
      attempted_at: entry.attempted_at,
      ok: entry.ok,
    };
    if (typeof entry.error === "string") {
      attempt.error = entry.error;
    }
    out[shortcode] = attempt;
  }
  return out;
}

/** Candidates not yet recorded in extract_auto (missing shortcode → skipped). */
export function filterUntriedExtractCandidates(
  candidates: ExtractCandidate[],
  metadata: Record<string, unknown> | undefined | null,
): ExtractCandidate[] {
  const tried = readExtractAutoMap(metadata);
  return candidates.filter((candidate) => {
    const shortcode = extractAutoShortcode(candidate);
    if (!shortcode) {
      return false;
    }
    return !Object.prototype.hasOwnProperty.call(tried, shortcode);
  });
}

export function mergeExtractAutoAttempt(
  metadata: Record<string, unknown>,
  shortcode: string,
  attempt: ExtractAutoAttempt,
): Record<string, unknown> {
  const prev = readExtractAutoMap(metadata);
  return {
    ...metadata,
    [EXTRACT_AUTO_METADATA_KEY]: {
      ...prev,
      [shortcode]: attempt,
    },
  };
}
