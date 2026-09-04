/**
 * Pure helpers for itemExtractAuto shortcode attempt maps.
 */

import type { ExtractCandidate } from "@collector/api";

export type ExtractAutoAttempt = {
  attempted_at: string;
  ok: boolean;
  error?: string;
};

export type ExtractAutoMap = Record<string, ExtractAutoAttempt>;

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

export function parseExtractAutoMap(raw: unknown): ExtractAutoMap {
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

/** Candidates not yet recorded (missing shortcode → skipped). */
export function filterUntriedExtractCandidates(
  candidates: ExtractCandidate[],
  tried: ExtractAutoMap,
): ExtractCandidate[] {
  return candidates.filter((candidate) => {
    const shortcode = extractAutoShortcode(candidate);
    if (!shortcode) {
      return false;
    }
    return !Object.prototype.hasOwnProperty.call(tried, shortcode);
  });
}
