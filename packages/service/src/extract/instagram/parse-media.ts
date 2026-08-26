/**
 * Normalize GraphQL / mobile-API Instagram media payloads into the fetch contract.
 */

import { asRecord } from "./json-unknown.js";
import type {
  InstagramFetchSuccess,
  InstagramFetchedMedia,
  InstagramMediaKind,
} from "./types.js";

export type ParsedMediaFields = Omit<InstagramFetchSuccess, "sourceUrl">;

function suggestedName(
  shortcode: string,
  kind: InstagramMediaKind,
  index: number,
  total: number,
): string {
  const ext = kind === "video" ? "mp4" : "jpg";
  if (total <= 1) {
    return `${shortcode}.${ext}`;
  }
  return `${shortcode}_${index + 1}.${ext}`;
}

function readUsername(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/^@+/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickFirstUrl(entries: unknown): string | null {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  for (const entry of entries) {
    const row = asRecord(entry);
    const url = row?.url;
    if (typeof url === "string" && url.length > 0) {
      return url;
    }
  }
  return null;
}

function graphqlCaption(media: Record<string, unknown>): string | null {
  const edgeRoot = asRecord(media.edge_media_to_caption);
  const edges = edgeRoot?.edges;
  if (!Array.isArray(edges) || edges.length === 0) {
    return null;
  }
  const first = asRecord(edges[0]);
  const node = asRecord(first?.node);
  return readOptionalString(node?.text);
}

function apiCaption(item: Record<string, unknown>): string | null {
  const caption = item.caption;
  if (caption === null || caption === undefined) {
    return null;
  }
  if (typeof caption === "string") {
    return readOptionalString(caption);
  }
  const row = asRecord(caption);
  return readOptionalString(row?.text);
}

function graphqlChildren(
  media: Record<string, unknown>,
): Record<string, unknown>[] {
  const sidecar = asRecord(media.edge_sidecar_to_children);
  const edges = sidecar?.edges;
  if (!Array.isArray(edges) || edges.length === 0) {
    return [media];
  }
  const nodes: Record<string, unknown>[] = [];
  for (const edge of edges) {
    const row = asRecord(edge);
    const node = asRecord(row?.node);
    if (node) {
      nodes.push(node);
    }
  }
  return nodes.length > 0 ? nodes : [media];
}

function mediaFromGraphqlNode(
  node: Record<string, unknown>,
): InstagramFetchedMedia | null {
  const isVideo =
    node.is_video === true || node.__typename === "GraphVideo";
  const videoUrl = readOptionalString(node.video_url);
  if (isVideo) {
    // Cover-only reel payloads must not be treated as downloadable media.
    if (!videoUrl) {
      return null;
    }
    return { kind: "video", url: videoUrl };
  }
  const displayUrl = readOptionalString(node.display_url);
  if (!displayUrl) {
    return null;
  }
  return { kind: "image", url: displayUrl };
}

function withSuggestedNames(
  shortcode: string,
  mediaItems: InstagramFetchedMedia[],
): InstagramFetchedMedia[] {
  return mediaItems.map((item, index) => ({
    ...item,
    suggestedFilename: suggestedName(
      shortcode,
      item.kind,
      index,
      mediaItems.length,
    ),
  }));
}

/**
 * Parse GraphQL `shortcode_media` / `xdt_shortcode_media` shape.
 * Returns null when author or media list cannot be established (caller tries next layer).
 */
export function parseGraphqlShortcodeMedia(
  media: unknown,
  shortcodeFallback: string,
): ParsedMediaFields | null {
  const root = asRecord(media);
  if (!root) {
    return null;
  }

  const owner = asRecord(root.owner);
  const authorUsername = readUsername(owner?.username);
  if (!authorUsername) {
    return null;
  }

  const shortcode =
    readOptionalString(root.shortcode) ?? shortcodeFallback;

  const mediaItems: InstagramFetchedMedia[] = [];
  for (const child of graphqlChildren(root)) {
    const item = mediaFromGraphqlNode(child);
    if (item) {
      mediaItems.push(item);
    }
  }

  if (mediaItems.length === 0) {
    return null;
  }

  return {
    shortcode,
    authorUsername,
    caption: graphqlCaption(root),
    accessibilityCaption: readOptionalString(root.accessibility_caption),
    media: withSuggestedNames(shortcode, mediaItems),
  };
}

function mediaFromApiItem(
  item: Record<string, unknown>,
): InstagramFetchedMedia | null {
  const videoUrl = pickFirstUrl(item.video_versions);
  if (videoUrl) {
    return { kind: "video", url: videoUrl };
  }
  const imageUrl = pickFirstUrl(asRecord(item.image_versions2)?.candidates);
  if (imageUrl) {
    return { kind: "image", url: imageUrl };
  }
  return null;
}

/**
 * Parse mobile / Polaris product item (`items[0]` / `if_not_gated_logged_out`).
 */
export function parseApiMediaItem(
  item: unknown,
  shortcodeFallback: string,
): ParsedMediaFields | null {
  const root = asRecord(item);
  if (!root) {
    return null;
  }

  const user = asRecord(root.user);
  const authorUsername = readUsername(user?.username);
  if (!authorUsername) {
    return null;
  }

  const shortcode =
    readOptionalString(root.code) ?? shortcodeFallback;

  const carousel = root.carousel_media;
  const children: Record<string, unknown>[] =
    Array.isArray(carousel) && carousel.length > 0
      ? carousel
          .map((entry) => asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => entry !== null)
      : [root];

  const mediaItems: InstagramFetchedMedia[] = [];
  for (const child of children) {
    const parsed = mediaFromApiItem(child);
    if (parsed) {
      mediaItems.push(parsed);
    }
  }

  if (mediaItems.length === 0) {
    return null;
  }

  return {
    shortcode,
    authorUsername,
    caption: apiCaption(root),
    accessibilityCaption: readOptionalString(root.accessibility_caption),
    media: withSuggestedNames(shortcode, mediaItems),
  };
}
