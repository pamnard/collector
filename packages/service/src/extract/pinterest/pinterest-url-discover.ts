/**
 * Pure Pinterest URL discovery for extract (#34).
 * No network — finds pin / pin.it URLs in note body only.
 */

import {
  collectHttpUrlsFromBody,
  parseRemoteHttpUrl,
} from "../collect-http-urls.js";

export type PinterestExtractCandidate = {
  extractorId: "pinterest";
  /** Normalized https URL */
  url: string;
  /**
   * Opaque extract_auto key (stored as ExtractCandidate.meta.shortcode):
   * numeric pin id, or `pinit:{code}` for short links.
   */
  shortcode: string;
};

const PINTEREST_HOST_SUFFIX = "pinterest.com";
const PIN_IT_HOSTS = new Set(["pin.it"]);

const PIN_IT_CODE_RE = /^[A-Za-z0-9_-]+$/;
const NUMERIC_PIN_ID_RE = /^\d+$/;
const SLUG_PIN_RE = /^(.+)--(\d+)$/;

type ParsedPinterestPin =
  | { kind: "pin"; pinId: string }
  | { kind: "pinit"; code: string };

function isPinterestHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  if (host === PINTEREST_HOST_SUFFIX || host.endsWith(`.${PINTEREST_HOST_SUFFIX}`)) {
    return true;
  }
  // ccTLD forms: pinterest.de, pinterest.co.uk, …
  return (
    /^pinterest\.[a-z]{2}$/i.test(host) ||
    /^pinterest\.[a-z]{2}\.[a-z]{2}$/i.test(host)
  );
}

/**
 * Pin id from a `/pin/...` path segment (numeric or `slug--id`).
 */
export function parsePinterestPinIdFromSegment(segment: string): string | null {
  if (NUMERIC_PIN_ID_RE.test(segment)) {
    return segment;
  }
  const slugMatch = SLUG_PIN_RE.exec(segment);
  if (slugMatch?.[2]) {
    return slugMatch[2];
  }
  return null;
}

/** Internal URL parse shared with `url.ts` fetch targeting. */
export function parsePinterestPin(url: string): ParsedPinterestPin | null {
  const parsed = parseRemoteHttpUrl(url);
  if (!parsed) {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (PIN_IT_HOSTS.has(host)) {
    const code = parsed.pathname.split("/").filter(Boolean)[0];
    if (code === undefined || !PIN_IT_CODE_RE.test(code)) {
      return null;
    }
    return { kind: "pinit", code };
  }

  if (!isPinterestHost(host)) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() !== "pin" || segments[1] === undefined) {
    return null;
  }

  const pinId = parsePinterestPinIdFromSegment(segments[1]);
  if (pinId === null) {
    return null;
  }
  return { kind: "pin", pinId };
}

/**
 * Stable extract key from a Pinterest pin / pin.it URL, or null when not a pin URL.
 */
export function parsePinterestShortcode(url: string): string | null {
  const media = parsePinterestPin(url);
  if (!media) {
    return null;
  }
  return media.kind === "pin" ? media.pinId : `pinit:${media.code}`;
}

function candidateFromUrl(raw: string): PinterestExtractCandidate | null {
  const media = parsePinterestPin(raw);
  if (!media) {
    return null;
  }
  if (media.kind === "pinit") {
    return {
      extractorId: "pinterest",
      url: `https://pin.it/${media.code}`,
      shortcode: `pinit:${media.code}`,
    };
  }
  return {
    extractorId: "pinterest",
    url: `https://www.pinterest.com/pin/${media.pinId}/`,
    shortcode: media.pinId,
  };
}

/**
 * Discover Pinterest extract candidates from note body only.
 * Frontmatter `url` is the stored canonical link after import — not a pending
 * import signal (#34). Dedupes by shortcode (first occurrence wins).
 */
export function discoverPinterestCandidates(input: {
  body: string;
  /** Ignored for candidates — kept for call-site compatibility. */
  frontmatterUrl?: string | null;
}): PinterestExtractCandidate[] {
  const byShortcode = new Map<string, PinterestExtractCandidate>();

  const consider = (raw: string | null | undefined) => {
    if (raw == null || raw.trim().length === 0) {
      return;
    }
    const candidate = candidateFromUrl(raw);
    if (!candidate || byShortcode.has(candidate.shortcode)) {
      return;
    }
    byShortcode.set(candidate.shortcode, candidate);
  };

  for (const raw of collectHttpUrlsFromBody(input.body)) {
    consider(raw);
  }

  return [...byShortcode.values()];
}
