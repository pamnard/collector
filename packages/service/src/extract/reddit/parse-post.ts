/**
 * Parse Reddit listing JSON into RedditFetchSuccess (#955).
 */

import { asRecord } from "../json-unknown.js";
import { canonicalPostUrl } from "./url.js";
import type {
  RedditFetchErrorCode,
  RedditFetchSuccess,
  RedditFetchedMedia,
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

/** Only Reddit-hosted CDN — never external link destinations. */
export function isRedditMediaCdnUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "i.redd.it" ||
    host === "v.redd.it" ||
    host === "preview.redd.it" ||
    host === "external-preview.redd.it" ||
    host === "i.redditmedia.com" ||
    host.endsWith(".redditmedia.com")
  );
}

function pushMedia(
  media: RedditFetchedMedia[],
  seen: Set<string>,
  kind: "image" | "video",
  url: string | null,
): void {
  if (url === null) {
    return;
  }
  const decoded = decodeHtmlEntities(url);
  if (seen.has(decoded) || !isRedditMediaCdnUrl(decoded)) {
    return;
  }
  seen.add(decoded);
  media.push({ kind, url: decoded });
}

function mediaExpectedFromPost(data: Record<string, unknown>): boolean {
  if (data.is_gallery === true) {
    return true;
  }
  if (data.is_video === true) {
    return true;
  }
  const hint = asString(data.post_hint);
  if (hint === "image" || hint === "hosted:video" || hint === "rich:video") {
    return true;
  }
  const url =
    asString(data.url_overridden_by_dest) ?? asString(data.url) ?? "";
  return url.length > 0 && isRedditMediaCdnUrl(url);
}

function collectGalleryMedia(
  data: Record<string, unknown>,
  media: RedditFetchedMedia[],
  seen: Set<string>,
): void {
  const gallery = asRecord(data.gallery_data);
  const metadata = asRecord(data.media_metadata);
  if (!gallery || !metadata) {
    return;
  }
  const items = gallery.items;
  if (!Array.isArray(items)) {
    return;
  }
  for (const item of items) {
    const rec = asRecord(item);
    if (!rec) {
      continue;
    }
    const mediaId = asString(rec.media_id);
    if (mediaId === null) {
      continue;
    }
    const entry = asRecord(metadata[mediaId]);
    if (!entry) {
      continue;
    }
    const status = asString(entry.status);
    if (status !== null && status !== "valid") {
      continue;
    }
    const s = asRecord(entry.s);
    if (!s) {
      continue;
    }
    pushMedia(
      media,
      seen,
      "image",
      asString(s.mp4) ?? asString(s.gif) ?? asString(s.u),
    );
  }
}

function collectVideoMedia(
  data: Record<string, unknown>,
  media: RedditFetchedMedia[],
  seen: Set<string>,
): void {
  for (const key of ["secure_media", "media"] as const) {
    const block = asRecord(data[key]);
    const redditVideo = asRecord(block?.reddit_video);
    if (!redditVideo) {
      continue;
    }
    pushMedia(
      media,
      seen,
      "video",
      // Progressive MP4 only — hls_url is a playlist, not attachable media bytes.
      asString(redditVideo.fallback_url),
    );
  }
}

function collectDirectAndPreviewMedia(
  data: Record<string, unknown>,
  media: RedditFetchedMedia[],
  seen: Set<string>,
): void {
  const direct =
    asString(data.url_overridden_by_dest) ?? asString(data.url);
  if (direct !== null && isRedditMediaCdnUrl(direct)) {
    // Bare v.redd.it/{id} is a player page — use secure_media.fallback_url instead.
    const bareVideoPage = /^https?:\/\/v\.redd\.it\/[^/?#]+\/?$/i.test(direct);
    if (!bareVideoPage) {
      const lower = direct.toLowerCase();
      const kind =
        lower.includes("v.redd.it") || lower.endsWith(".mp4")
          ? "video"
          : "image";
      pushMedia(media, seen, kind, direct);
    }
  }

  // Prefer direct CDN over preview thumbnails when we already have media.
  if (media.length > 0) {
    return;
  }

  const preview = asRecord(data.preview);
  const images = preview?.images;
  if (!Array.isArray(images)) {
    return;
  }
  for (const image of images) {
    const rec = asRecord(image);
    if (!rec) {
      continue;
    }
    const source = asRecord(rec.source);
    pushMedia(media, seen, "image", asString(source?.url));
  }
}

function extractPostData(root: unknown): Record<string, unknown> | null {
  const listings = Array.isArray(root) ? root : [root];
  for (const listing of listings) {
    const listingRec = asRecord(listing);
    const data = asRecord(listingRec?.data);
    const children = data?.children;
    if (!Array.isArray(children)) {
      continue;
    }
    for (const child of children) {
      const childRec = asRecord(child);
      if (asString(childRec?.kind) !== "t3") {
        continue;
      }
      const post = asRecord(childRec?.data);
      if (post) {
        return post;
      }
    }
  }
  return null;
}

function resolveSourceUrl(
  post: Record<string, unknown>,
  submissionId: string,
  fallbackSourceUrl: string,
): string {
  const permalink = asString(post.permalink);
  if (permalink !== null) {
    const path = permalink.startsWith("/") ? permalink : `/${permalink}`;
    const withSlash = path.endsWith("/") ? path : `${path}/`;
    return `https://www.reddit.com${withSlash}`;
  }
  const subreddit = asString(post.subreddit);
  if (fallbackSourceUrl.includes(submissionId)) {
    return fallbackSourceUrl.endsWith("/")
      ? fallbackSourceUrl
      : `${fallbackSourceUrl}/`;
  }
  return canonicalPostUrl(submissionId, subreddit);
}

export type ParseRedditPostResult =
  | { ok: true; value: RedditFetchSuccess }
  | { ok: false; code: RedditFetchErrorCode; message: string };

/**
 * Parse Reddit post `.json` body into a fetch success payload.
 */
export function parseRedditPostJson(
  bodyText: string,
  fallbackSourceUrl: string,
): ParseRedditPostResult {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      code: "not_found",
      message: "Reddit JSON response was empty",
    };
  }

  let root: unknown;
  try {
    root = JSON.parse(trimmed) as unknown;
  } catch {
    return {
      ok: false,
      code: "login_wall",
      message: "Reddit returned non-JSON (login or blocked page)",
    };
  }

  if (
    root !== null &&
    typeof root === "object" &&
    !Array.isArray(root) &&
    Object.keys(root as object).length === 0
  ) {
    return {
      ok: false,
      code: "not_found",
      message: "Reddit JSON was an empty object",
    };
  }

  const post = extractPostData(root);
  if (!post) {
    const errObj = asRecord(root);
    const message = asString(errObj?.message) ?? asString(errObj?.reason);
    if (message) {
      return {
        ok: false,
        code: "private_or_unavailable",
        message: `Reddit refused the post: ${message}`,
      };
    }
    return {
      ok: false,
      code: "not_found",
      message: "Reddit JSON contained no t3 submission",
    };
  }

  const removed = asString(post.removed_by_category);
  if (removed !== null) {
    return {
      ok: false,
      code: "private_or_unavailable",
      message: `Reddit post unavailable (${removed})`,
    };
  }

  const submissionId = asString(post.id);
  if (submissionId === null) {
    return {
      ok: false,
      code: "invalid_url",
      message: "Reddit post JSON missing id",
    };
  }

  const selftextRaw = asString(post.selftext);
  const selftext =
    selftextRaw !== null &&
    selftextRaw !== "[removed]" &&
    selftextRaw !== "[deleted]"
      ? selftextRaw
      : null;

  const authorRaw = asString(post.author);
  const authorUsername =
    authorRaw !== null && authorRaw !== "[deleted]" ? authorRaw : null;

  const media: RedditFetchedMedia[] = [];
  const seen = new Set<string>();
  collectGalleryMedia(post, media, seen);
  collectVideoMedia(post, media, seen);
  collectDirectAndPreviewMedia(post, media, seen);

  if (mediaExpectedFromPost(post) && media.length === 0) {
    return {
      ok: false,
      code: "no_media",
      message: "Reddit media post had no downloadable CDN URLs",
    };
  }

  return {
    ok: true,
    value: {
      sourceUrl: resolveSourceUrl(post, submissionId, fallbackSourceUrl),
      submissionId,
      authorUsername,
      title: asString(post.title),
      selftext,
      media,
    },
  };
}
