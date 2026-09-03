/**
 * Parse Pinterest pin payload fields from HTML / PinResource JSON (#34).
 */

import { asRecord } from "../json-unknown.js";
import type { PinterestFetchedMedia, PinterestFetchSuccess } from "./types.js";

type ParsedPinFields = Omit<PinterestFetchSuccess, "sourceUrl">;

const PWS_BFS_MAX_NODES = 5_000;

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickLargestImageUrl(images: unknown): string | null {
  const record = asRecord(images);
  if (!record) {
    return null;
  }
  let bestUrl: string | null = null;
  let bestArea = -1;
  for (const value of Object.values(record)) {
    const image = asRecord(value);
    if (!image) {
      continue;
    }
    const url = asString(image.url);
    if (!url) {
      continue;
    }
    const width = typeof image.width === "number" ? image.width : 0;
    const height = typeof image.height === "number" ? image.height : 0;
    const area = width * height;
    if (area >= bestArea) {
      bestArea = area;
      bestUrl = url;
    }
  }
  return bestUrl;
}

function mediaFromPin(pin: Record<string, unknown>): PinterestFetchedMedia[] {
  const videos = asRecord(pin.videos);
  const videoList = videos ? asRecord(videos.video_list) : null;
  if (videoList) {
    let bestVideo: string | null = null;
    let bestWidth = -1;
    for (const value of Object.values(videoList)) {
      const entry = asRecord(value);
      if (!entry) {
        continue;
      }
      const url = asString(entry.url);
      if (!url) {
        continue;
      }
      const width = typeof entry.width === "number" ? entry.width : 0;
      if (width >= bestWidth) {
        bestWidth = width;
        bestVideo = url;
      }
    }
    // Video XOR image (same as Instagram): poster is not a second attachment.
    if (bestVideo) {
      return [{ kind: "video", url: bestVideo }];
    }
  }

  const images = asRecord(pin.images);
  const orig = images ? asRecord(images.orig) : null;
  const resolvedImage =
    (orig ? asString(orig.url) : null) ?? pickLargestImageUrl(pin.images);
  if (resolvedImage) {
    return [{ kind: "image", url: resolvedImage }];
  }

  return [];
}

function authorFromPin(pin: Record<string, unknown>): string | null {
  const pinner = asRecord(pin.pinner) ?? asRecord(pin.closeup_attribution);
  if (!pinner) {
    return null;
  }
  return asString(pinner.username) ?? asString(pinner.full_name);
}

export function parsePinResourceData(
  data: unknown,
  expectedPinId: string,
): ParsedPinFields | null {
  const root = asRecord(data);
  if (!root) {
    return null;
  }
  const resourceResponse = asRecord(root.resource_response);
  const pin =
    asRecord(resourceResponse?.data) ??
    asRecord(root.data) ??
    asRecord(root);
  if (!pin) {
    return null;
  }

  const idRaw = pin.id ?? pin.pin_id;
  if (idRaw !== undefined && idRaw !== null) {
    const pinId = String(idRaw);
    if (pinId !== expectedPinId) {
      return null;
    }
  }

  const media = mediaFromPin(pin);
  if (media.length === 0) {
    return null;
  }

  return {
    pinId: expectedPinId,
    authorUsername: authorFromPin(pin),
    title: asString(pin.title) ?? asString(pin.grid_title),
    description:
      asString(pin.closeup_unified_description) ??
      asString(pin.description) ??
      null,
    media,
  };
}

/**
 * Extract `__PWS_DATA__` / og:* fallbacks from pin HTML.
 */
export function parsePinFromHtml(
  html: string,
  expectedPinId: string,
): ParsedPinFields | null {
  const pws = extractPwsData(html);
  if (pws) {
    const fromPws = findPinInPwsData(pws, expectedPinId);
    if (fromPws) {
      return fromPws;
    }
  }

  const ogImage = extractMetaContent(html, "og:image");
  const ogTitle = extractMetaContent(html, "og:title");
  const ogDescription = extractMetaContent(html, "og:description");
  if (ogImage) {
    return {
      pinId: expectedPinId,
      authorUsername: null,
      title: ogTitle,
      description: ogDescription,
      media: [{ kind: "image", url: ogImage }],
    };
  }

  return null;
}

function extractPwsData(html: string): unknown | null {
  const match = /id="__PWS_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function findPinInPwsData(
  data: unknown,
  expectedPinId: string,
): ParsedPinFields | null {
  const props = asRecord(asRecord(data)?.props);
  const redux = asRecord(props?.initialReduxState);
  const pins = asRecord(redux?.pins);
  const direct = pins ? asRecord(pins[expectedPinId]) : null;
  if (direct) {
    const parsed = parsePinResourceData({ data: direct }, expectedPinId);
    if (parsed) {
      return parsed;
    }
  }

  // Bounded fallback when Redux path misses (related pins / alternate shells).
  const queue: unknown[] = [data];
  const seen = new Set<unknown>();
  let visited = 0;
  while (queue.length > 0 && visited < PWS_BFS_MAX_NODES) {
    const current = queue.pop();
    visited += 1;
    if (current === null || current === undefined) {
      continue;
    }
    if (typeof current !== "object") {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    const record = asRecord(current);
    if (record) {
      const idRaw = record.id ?? record.pin_id;
      const id =
        typeof idRaw === "string" || typeof idRaw === "number"
          ? String(idRaw)
          : null;
      if (id === expectedPinId && (record.images || record.videos)) {
        const parsed = parsePinResourceData({ data: record }, expectedPinId);
        if (parsed) {
          return parsed;
        }
      }
      for (const value of Object.values(record)) {
        queue.push(value);
      }
      continue;
    }

    if (Array.isArray(current)) {
      for (const value of current) {
        queue.push(value);
      }
    }
  }
  return null;
}

function extractMetaContent(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  const match = re.exec(html) ?? alt.exec(html);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}

export function toFetchSuccess(
  fields: ParsedPinFields,
  sourceUrl: string,
): PinterestFetchSuccess {
  return {
    sourceUrl,
    ...fields,
  };
}
