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
 * Extract pin fields from pin HTML (`__PWS_DATA__`, then embedded `v3GetPinQueryv2`).
 * Open Graph is not used for media (or as a pin media fallback).
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

  const fromGraphql = findPinInV3GetPinQuery(html, expectedPinId);
  if (fromGraphql) {
    return fromGraphql;
  }

  return null;
}

function findPinInV3GetPinQuery(
  html: string,
  expectedPinId: string,
): ParsedPinFields | null {
  const marker = '"v3GetPinQueryv2"';
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const markerAt = html.indexOf(marker, searchFrom);
    if (markerAt < 0) {
      return null;
    }
    const objectStart = html.lastIndexOf('{"data":{', markerAt);
    if (objectStart < 0 || objectStart < markerAt - 80) {
      searchFrom = markerAt + marker.length;
      continue;
    }
    const extracted = extractJsonObjectAt(html, objectStart);
    if (!extracted) {
      searchFrom = markerAt + marker.length;
      continue;
    }
    const root = asRecord(extracted.value);
    const data = asRecord(root?.data);
    const query = asRecord(data?.v3GetPinQueryv2);
    const pin = asRecord(query?.data);
    if (pin) {
      const legacy = normalizeGraphqlPinToLegacy(pin, expectedPinId);
      if (legacy) {
        const parsed = parsePinResourceData({ data: legacy }, expectedPinId);
        if (parsed) {
          return parsed;
        }
      }
    }
    searchFrom = extracted.end;
  }
  return null;
}

function extractJsonObjectAt(
  text: string,
  start: number,
): { value: unknown; end: number } | null {
  if (text[start] !== "{") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return { value: JSON.parse(slice), end: i + 1 };
        } catch (error) {
          if (error instanceof SyntaxError) {
            return null;
          }
          throw error;
        }
      }
    }
  }
  return null;
}

function normalizeGraphqlPinToLegacy(
  pin: Record<string, unknown>,
  expectedPinId: string,
): Record<string, unknown> | null {
  const idRaw = pin.entityId ?? pin.id ?? pin.pin_id;
  if (idRaw !== undefined && idRaw !== null) {
    if (String(idRaw) !== expectedPinId) {
      return null;
    }
  }

  const images: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pin)) {
    const match = /^images_(.+)$/.exec(key);
    if (!match?.[1]) {
      continue;
    }
    const details = asRecord(value);
    if (!details) {
      continue;
    }
    images[match[1]] = details;
  }

  const title =
    asString(pin.title) ??
    asString(pin.gridTitle) ??
    asString(pin.unauthOnPageTitle) ??
    asString(pin.seoTitle);

  const description =
    asString(pin.closeupUnifiedDescription) ??
    asString(pin.description) ??
    asString(pin.unauthOnPageDescription);

  const pinner = asRecord(pin.pinner);
  const closeupAttribution =
    asRecord(pin.closeupAttribution) ?? asRecord(pin.closeup_attribution);

  const legacy: Record<string, unknown> = {
    id: expectedPinId,
    title: title ?? "",
    grid_title: asString(pin.gridTitle) ?? title ?? "",
    closeup_unified_description: description,
    description,
    pinner: pinner ?? undefined,
    closeup_attribution: closeupAttribution ?? undefined,
    images,
  };

  const videos = normalizeGraphqlVideos(pin.videos);
  if (videos) {
    legacy.videos = videos;
  }

  return legacy;
}

function normalizeGraphqlVideos(videos: unknown): Record<string, unknown> | null {
  const record = asRecord(videos);
  if (!record) {
    return null;
  }
  const existingList = asRecord(record.video_list);
  if (existingList) {
    return { video_list: existingList };
  }

  // GraphQL sometimes nests playable URLs under videoList / video_list-like maps.
  const videoList = asRecord(record.videoList);
  if (videoList) {
    return { video_list: videoList };
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

export function toFetchSuccess(
  fields: ParsedPinFields,
  sourceUrl: string,
): PinterestFetchSuccess {
  return {
    sourceUrl,
    ...fields,
  };
}
