/**
 * Parse syndication tweet-result JSON into TwitterFetchSuccess (#954).
 */

import { asRecord } from "../json-unknown.js";
import { canonicalStatusUrl } from "./url.js";
import type {
  TwitterFetchSuccess,
  TwitterFetchedMedia,
} from "./types.js";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Syndication appends pic.twitter.com / t.co media short links to `text`.
 * Strip them so merge does not re-queue extract_auto on the same note.
 */
export function stripTrailingMediaShortLinks(text: string): string {
  return text
    .replace(
      /\s*https?:\/\/(?:t\.co\/[A-Za-z0-9]+|pic\.(?:twitter|x)\.com\/[A-Za-z0-9]+)\s*$/gi,
      "",
    )
    .replace(
      /\s*https?:\/\/(?:t\.co\/[A-Za-z0-9]+|pic\.(?:twitter|x)\.com\/[A-Za-z0-9]+)/gi,
      "",
    )
    .trimEnd();
}

/** Only CDN hosts — never t.co / x.com photo pages (HTML, not bytes). */
export function isTwitterMediaCdnUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "pbs.twimg.com" || host.endsWith(".twimg.com");
}

function collectMedia(root: Record<string, unknown>): TwitterFetchedMedia[] {
  const media: TwitterFetchedMedia[] = [];
  const seen = new Set<string>();

  const push = (kind: "image" | "video", url: string | null) => {
    if (url === null || seen.has(url) || !isTwitterMediaCdnUrl(url)) {
      return;
    }
    seen.add(url);
    media.push({ kind, url });
  };

  const photos = root.photos;
  if (Array.isArray(photos)) {
    for (const entry of photos) {
      const rec = asRecord(entry);
      if (!rec) {
        continue;
      }
      push(
        "image",
        asString(rec.media_url_https) ?? asString(rec.url),
      );
    }
  }

  const entities = asRecord(root.entities);
  const entityMedia = entities?.media;
  if (Array.isArray(entityMedia)) {
    for (const entry of entityMedia) {
      const rec = asRecord(entry);
      if (!rec) {
        continue;
      }
      const type = asString(rec.type);
      if (type === "video" || type === "animated_gif") {
        continue;
      }
      push(
        "image",
        asString(rec.media_url_https) ?? asString(rec.url),
      );
    }
  }

  const video = asRecord(root.video);
  if (video) {
    const variants = video.variants;
    if (Array.isArray(variants)) {
      let bestUrl: string | null = null;
      let bestBitrate = -1;
      for (const variant of variants) {
        const rec = asRecord(variant);
        if (!rec) {
          continue;
        }
        const contentType = asString(rec.content_type) ?? "";
        if (!contentType.includes("mp4")) {
          continue;
        }
        const url = asString(rec.src) ?? asString(rec.url);
        const bitrate =
          typeof rec.bitrate === "number" ? rec.bitrate : 0;
        if (url !== null && bitrate >= bestBitrate) {
          bestBitrate = bitrate;
          bestUrl = url;
        }
      }
      push("video", bestUrl);
    }
    push("video", asString(video.url));
  }

  const mediaDetails = root.mediaDetails;
  if (Array.isArray(mediaDetails)) {
    for (const entry of mediaDetails) {
      const rec = asRecord(entry);
      if (!rec) {
        continue;
      }
      const type = asString(rec.type);
      if (type === "video" || type === "animated_gif") {
        const videoInfo = asRecord(rec.video_info);
        const variants = videoInfo?.variants;
        if (Array.isArray(variants)) {
          let bestUrl: string | null = null;
          let bestBitrate = -1;
          for (const variant of variants) {
            const v = asRecord(variant);
            if (!v) {
              continue;
            }
            const contentType = asString(v.content_type) ?? "";
            if (!contentType.includes("mp4")) {
              continue;
            }
            const url = asString(v.url);
            const bitrate =
              typeof v.bitrate === "number" ? v.bitrate : 0;
            if (url !== null && bitrate >= bestBitrate) {
              bestBitrate = bitrate;
              bestUrl = url;
            }
          }
          push("video", bestUrl);
        }
      } else {
        push(
          "image",
          asString(rec.media_url_https) ?? asString(rec.url),
        );
      }
    }
  }

  return media;
}

/**
 * Map syndication tweet-result JSON to fetch success, or null when unusable.
 */
export function parseStatusFromSyndication(
  json: unknown,
  statusId: string,
  sourceUrl?: string,
): TwitterFetchSuccess | null {
  const root = asRecord(json);
  if (!root) {
    return null;
  }

  const user = asRecord(root.user);
  const authorUsername =
    asString(user?.screen_name) ?? asString(user?.username) ?? null;

  const noteTweet = asRecord(root.note_tweet);
  const rawText =
    asString(root.text) ??
    asString(root.full_text) ??
    asString(noteTweet?.text);
  const text =
    rawText === null
      ? null
      : stripTrailingMediaShortLinks(decodeHtmlEntities(rawText));

  const media = collectMedia(root);
  if ((text === null || text.trim().length === 0) && media.length === 0) {
    return null;
  }

  return {
    kind: "status",
    sourceUrl: sourceUrl ?? canonicalStatusUrl(statusId, authorUsername),
    contentId: statusId,
    authorUsername,
    title: null,
    text,
    media,
  };
}
