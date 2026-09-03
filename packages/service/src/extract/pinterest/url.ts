/**
 * Parse Pinterest pin / pin.it URLs into a fetch target (#34).
 * Boards / profiles / search are rejected.
 */

import { parsePinterestPin } from "./pinterest-url-discover.js";

export type ParsedPinterestTarget =
  | {
      kind: "pin";
      pinId: string;
      sourceUrl: string;
    }
  | {
      kind: "pinit";
      code: string;
      sourceUrl: string;
    };

export function canonicalPinUrl(pinId: string): string {
  return `https://www.pinterest.com/pin/${pinId}/`;
}

export function parsePinterestTarget(
  urlOrPinId: string,
): ParsedPinterestTarget | null {
  const raw = urlOrPinId.trim();
  if (!raw) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    return {
      kind: "pin",
      pinId: raw,
      sourceUrl: canonicalPinUrl(raw),
    };
  }

  const media = parsePinterestPin(raw);
  if (!media) {
    return null;
  }
  if (media.kind === "pinit") {
    return {
      kind: "pinit",
      code: media.code,
      sourceUrl: `https://pin.it/${media.code}`,
    };
  }
  return {
    kind: "pin",
    pinId: media.pinId,
    sourceUrl: canonicalPinUrl(media.pinId),
  };
}
