/**
 * Localize remote display assets into the note media folder (#739).
 *
 * Product rule: covers, gallery files, and markdown images must live on disk
 * under `media/<noteUuid>/`. Remote http(s) is never a valid standing display
 * source. `item.url` (content link) may remain remote.
 */

import { inferMediaType, sanitizeMediaFilename } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import {
  parseDocumentMarkdown,
  partitionDocumentFrontmatter,
  serializeDocumentMarkdown,
} from "./frontmatter.js";
import { attachMediaFile } from "./media-operations.js";
import { applyItemCover } from "./cover-operations.js";
import { mediaFilePath } from "./media-io.js";
import { itemCoverPath } from "./paths.js";
import {
  isRemoteHttpUrl,
  youtubeTeaserDownloadUrl,
} from "./youtube-video-id.js";

export {
  isRemoteHttpUrl,
  parseYouTubeVideoId,
  youtubeTeaserDownloadUrl,
} from "./youtube-video-id.js";

export interface MarkdownRemoteImageRef {
  /** Exact destination string as written in `![…](…)`. */
  rawUrl: string;
  /** Start index of the destination inside `body` (after `](`). */
  urlStart: number;
  /** End index (exclusive) of the destination inside `body`. */
  urlEnd: number;
}

function skipInlineCode(body: string, start: number): number {
  let i = start + 1;
  while (i < body.length && body[i] === "`") {
    i += 1;
  }
  const fenceLen = i - start;
  const close = body.indexOf("`".repeat(fenceLen), i);
  return close === -1 ? body.length : close + fenceLen;
}

function isFenceOpener(
  body: string,
  index: number,
): { marker: string; end: number } | null {
  const ch = body[index];
  if (ch !== "`" && ch !== "~") {
    return null;
  }
  let end = index;
  while (end < body.length && body[end] === ch) {
    end += 1;
  }
  const len = end - index;
  if (len < 3) {
    return null;
  }
  if (index > 0 && body[index - 1] !== "\n") {
    return null;
  }
  return { marker: body.slice(index, end), end };
}

function findFenceClose(body: string, from: number, marker: string): number {
  let i = from;
  while (i < body.length) {
    const nl = body.indexOf("\n", i);
    const lineStart = nl === -1 ? body.length : nl + 1;
    if (lineStart >= body.length) {
      return body.length;
    }
    if (body.startsWith(marker, lineStart)) {
      let j = lineStart + marker.length;
      while (j < body.length && body[j] === marker[0]) {
        j += 1;
      }
      let k = j;
      while (k < body.length && (body[k] === " " || body[k] === "\t")) {
        k += 1;
      }
      if (k >= body.length || body[k] === "\n") {
        return k < body.length ? k + 1 : k;
      }
    }
    i = lineStart;
  }
  return body.length;
}

/**
 * Collect `![…](http(s)://…)` destinations in document order (code fences skipped).
 */
export function extractMarkdownRemoteImageRefs(
  body: string,
): MarkdownRemoteImageRef[] {
  const refs: MarkdownRemoteImageRef[] = [];
  let i = 0;
  while (i < body.length) {
    const fence = isFenceOpener(body, i);
    if (fence) {
      i = findFenceClose(body, fence.end, fence.marker);
      continue;
    }
    if (body[i] === "`") {
      i = skipInlineCode(body, i);
      continue;
    }
    if (body[i] === "!" && body[i + 1] === "[" && body[i + 2] === "[") {
      const close = body.indexOf("]]", i + 3);
      i = close === -1 ? body.length : close + 2;
      continue;
    }
    if (body[i] === "!" && body[i + 1] === "[") {
      const labelClose = body.indexOf("]", i + 2);
      if (labelClose === -1) {
        i += 1;
        continue;
      }
      if (body[labelClose + 1] !== "(") {
        i += 1;
        continue;
      }
      const urlStart = labelClose + 2;
      let j = urlStart;
      let depth = 1;
      while (j < body.length && depth > 0) {
        const ch = body[j]!;
        if (ch === "(") {
          depth += 1;
        } else if (ch === ")") {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        } else if (ch === "\n") {
          break;
        }
        j += 1;
      }
      if (depth !== 0) {
        i += 1;
        continue;
      }
      let raw = body.slice(urlStart, j).trim();
      if (raw.startsWith("<") && raw.endsWith(">")) {
        raw = raw.slice(1, -1).trim();
      }
      const space = raw.search(/\s/);
      if (space !== -1) {
        raw = raw.slice(0, space).trim();
      }
      if (isRemoteHttpUrl(raw)) {
        refs.push({ rawUrl: raw, urlStart, urlEnd: j });
      }
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return refs;
}

/** Rewrite every occurrence of `fromUrl` destinations that match remote refs. */
export function rewriteMarkdownRemoteImageUrls(
  body: string,
  replacements: ReadonlyMap<string, string>,
): string {
  if (replacements.size === 0) {
    return body;
  }
  const refs = extractMarkdownRemoteImageRefs(body);
  if (refs.length === 0) {
    return body;
  }
  let out = body;
  // Apply from the end so earlier offsets stay valid.
  for (let index = refs.length - 1; index >= 0; index -= 1) {
    const ref = refs[index]!;
    const local = replacements.get(ref.rawUrl);
    if (!local) {
      continue;
    }
    out = `${out.slice(0, ref.urlStart)}${local}${out.slice(ref.urlEnd)}`;
  }
  return out;
}

export function filenameFromRemoteImageUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch (error) {
    throw new Error(
      `localizeRemoteDisplayAssets: invalid image URL ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const base = pathname.split("/").filter(Boolean).pop() ?? "image";
  const withExt = base.includes(".") ? base : `${base}.jpg`;
  return sanitizeMediaFilename(withExt);
}

export type FetchRemoteBytes = (url: string) => Promise<Uint8Array>;

export type EncodeCoverWebp = (
  data: Uint8Array,
  filename: string,
) => Promise<Uint8Array>;

export interface LocalizeRemoteDisplayAssetsOptions {
  ctx: VaultContext;
  vaultPath: string;
  vaultId: string;
  itemId: string;
  rawMarkdown: string;
  /** Item content URL (may be remote). Used for YouTube teaser download. */
  itemUrl?: string | null;
  fetchBytes: FetchRemoteBytes;
  /** Convert downloaded image bytes to cover.webp. Required when a cover is needed. */
  encodeCoverWebp: EncodeCoverWebp;
}

export interface LocalizeRemoteDisplayAssetsResult {
  text: string;
  changed: boolean;
}

async function downloadOrThrow(
  fetchBytes: FetchRemoteBytes,
  url: string,
  role: string,
): Promise<Uint8Array> {
  try {
    const bytes = await fetchBytes(url);
    if (!bytes || bytes.byteLength === 0) {
      throw new Error(`${role}: empty response from ${url}`);
    }
    return bytes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("localizeRemoteDisplayAssets: download failed", {
      role,
      url,
      error: message,
    });
    throw new Error(
      `localizeRemoteDisplayAssets: failed to download ${role} from ${url}: ${message}`,
      { cause: error },
    );
  }
}

/**
 * Download remote markdown images + FM thumbnail + YouTube teaser into note media.
 * Rewrites the document to local paths. Fails hard on any download error (#739).
 */
export async function localizeRemoteDisplayAssets(
  options: LocalizeRemoteDisplayAssetsOptions,
): Promise<LocalizeRemoteDisplayAssetsResult> {
  const {
    ctx,
    vaultPath,
    vaultId,
    itemId,
    fetchBytes,
    encodeCoverWebp,
  } = options;

  const parsed = parseDocumentMarkdown(options.rawMarkdown);
  const { known, properties } = partitionDocumentFrontmatter(parsed.frontmatter);

  let body = parsed.body;
  let changed = false;

  const remoteImageRefs = extractMarkdownRemoteImageRefs(body);
  const uniqueRemoteUrls = [...new Set(remoteImageRefs.map((r) => r.rawUrl))];
  const urlToLocal = new Map<string, string>();

  for (const remoteUrl of uniqueRemoteUrls) {
    const bytes = await downloadOrThrow(
      fetchBytes,
      remoteUrl,
      "markdown image",
    );
    const filename = filenameFromRemoteImageUrl(remoteUrl);
    const media = await attachMediaFile(ctx, vaultPath, itemId, {
      filename,
      data: bytes,
      mediaType: inferMediaType(filename),
    });
    const absolute = mediaFilePath(
      vaultPath,
      itemId,
      media.id,
      media.filename,
    );
    urlToLocal.set(remoteUrl, absolute);
  }

  if (urlToLocal.size > 0) {
    const nextBody = rewriteMarkdownRemoteImageUrls(body, urlToLocal);
    if (nextBody !== body) {
      body = nextBody;
      changed = true;
    }
  }

  const fmThumbnail =
    typeof known.thumbnail === "string" ? known.thumbnail : null;
  let clearThumbnail = false;

  if (fmThumbnail && isRemoteHttpUrl(fmThumbnail)) {
    const bytes = await downloadOrThrow(
      fetchBytes,
      fmThumbnail,
      "frontmatter thumbnail",
    );
    const filename = filenameFromRemoteImageUrl(fmThumbnail);
    const cover = await encodeCoverWebp(bytes, filename);
    await applyItemCover(ctx, vaultPath, vaultId, itemId, cover);
    clearThumbnail = true;
    changed = true;
  }

  const itemUrl =
    options.itemUrl !== undefined
      ? options.itemUrl
      : typeof known.url === "string"
        ? known.url
        : null;
  const teaserUrl = itemUrl ? youtubeTeaserDownloadUrl(itemUrl) : null;
  const coverPath = itemCoverPath(vaultPath, itemId);
  const hasCover = await ctx.fs.exists(coverPath);

  if (teaserUrl && !hasCover) {
    const bytes = await downloadOrThrow(
      fetchBytes,
      teaserUrl,
      "YouTube teaser",
    );
    const cover = await encodeCoverWebp(bytes, "mqdefault.jpg");
    await applyItemCover(ctx, vaultPath, vaultId, itemId, cover);
    changed = true;
  }

  if (clearThumbnail) {
    const frontmatter: Record<string, unknown> = { ...properties };
    for (const [key, value] of Object.entries(known)) {
      if (value !== undefined && key !== "thumbnail") {
        frontmatter[key] = value;
      }
    }
    frontmatter.thumbnail = null;
    const text = serializeDocumentMarkdown(frontmatter, body);
    return { text, changed: true };
  }

  if (changed) {
    const frontmatter: Record<string, unknown> = { ...properties };
    for (const [key, value] of Object.entries(known)) {
      if (value !== undefined) {
        frontmatter[key] = value;
      }
    }
    return {
      text: serializeDocumentMarkdown(frontmatter, body),
      changed: true,
    };
  }

  return { text: options.rawMarkdown, changed: false };
}

/** Reject remote http(s) left in asset fields after localization should have run. */
export function assertNoRemoteDisplayAssetUrl(
  value: string | null | undefined,
  field: string,
): void {
  if (value && isRemoteHttpUrl(value)) {
    throw new Error(
      `assertNoRemoteDisplayAssetUrl: ${field} must not be a remote URL (#739): ${value}`,
    );
  }
}
