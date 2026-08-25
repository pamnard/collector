/**
 * Localize remote display assets into the note media folder (#739).
 *
 * Product rule: covers, gallery files, and markdown images must live on disk
 * under `media/<noteUuid>/`. Remote http(s) is never a valid standing display
 * source. `item.url` (content link) may remain remote.
 */

import {
  inferMediaType,
  sanitizeMediaFilename,
  type GeneratedCover,
} from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import {
  parseDocumentMarkdown,
  partitionDocumentFrontmatter,
  serializeDocumentMarkdown,
} from "./frontmatter.js";
import { attachMediaFile, deleteMediaFile } from "./media-operations.js";
import { applyItemCover } from "./cover-operations.js";
import { mediaFilePath } from "./media-io.js";
import { itemCoverPath } from "./paths.js";
import {
  isRemoteHttpUrl,
  normalizeRemoteHttpUrl,
  youtubeTeaserDownloadUrl,
} from "./youtube-video-id.js";

export interface MarkdownRemoteImageRef {
  /** Exact destination URL token as written (may be protocol-relative). */
  rawUrl: string;
  /** Start index of the destination span inside `body` (after `](`). */
  urlStart: number;
  /** End index (exclusive) of the destination span inside `body`. */
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

function parseDestinationUrl(rawDest: string): string | null {
  let raw = rawDest.trim();
  if (raw.startsWith("<") && raw.endsWith(">")) {
    raw = raw.slice(1, -1).trim();
  }
  const space = raw.search(/\s/);
  if (space !== -1) {
    raw = raw.slice(0, space).trim();
  }
  return isRemoteHttpUrl(raw) ? raw : null;
}

/**
 * Collect remote image destinations: inline `![…](http…)` / `![…](//…)` and
 * reference-style `![…][id]` with `[id]: http…` (code fences skipped).
 */
export function extractMarkdownRemoteImageRefs(
  body: string,
): MarkdownRemoteImageRef[] {
  const refs: MarkdownRemoteImageRef[] = [];
  const definitions = new Map<string, { url: string; start: number; end: number }>();

  // Pass 1: reference definitions `[id]: url` (line-start).
  {
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
      const atLineStart = i === 0 || body[i - 1] === "\n";
      if (atLineStart && body[i] === "[") {
        const labelClose = body.indexOf("]", i + 1);
        if (
          labelClose !== -1 &&
          body[labelClose + 1] === ":" &&
          !body.slice(i + 1, labelClose).includes("\n")
        ) {
          const label = body.slice(i + 1, labelClose).trim().toLowerCase();
          let valueStart = labelClose + 2;
          while (
            valueStart < body.length &&
            (body[valueStart] === " " || body[valueStart] === "\t")
          ) {
            valueStart += 1;
          }
          let valueEnd = valueStart;
          while (valueEnd < body.length && body[valueEnd] !== "\n") {
            valueEnd += 1;
          }
          const url = parseDestinationUrl(body.slice(valueStart, valueEnd));
          if (label && url) {
            definitions.set(label, { url, start: valueStart, end: valueEnd });
          }
          i = valueEnd;
          continue;
        }
      }
      i += 1;
    }
  }

  // Pass 2: inline images + reference images.
  {
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
        const after = body[labelClose + 1];
        if (after === "(") {
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
          const url = parseDestinationUrl(body.slice(urlStart, j));
          if (url) {
            refs.push({ rawUrl: url, urlStart, urlEnd: j });
          }
          i = j + 1;
          continue;
        }
        if (after === "[") {
          const refClose = body.indexOf("]", labelClose + 2);
          if (refClose === -1) {
            i += 1;
            continue;
          }
          const refLabel = body
            .slice(labelClose + 2, refClose)
            .trim()
            .toLowerCase();
          const def = definitions.get(refLabel);
          if (def) {
            refs.push({
              rawUrl: def.url,
              urlStart: def.start,
              urlEnd: def.end,
            });
          }
          i = refClose + 1;
          continue;
        }
        // Shortcut reference `![label]` → `[label]: url`
        const shortcut = body.slice(i + 2, labelClose).trim().toLowerCase();
        const def = definitions.get(shortcut);
        if (def && (after === undefined || /\s/.test(after) || after === "\n")) {
          refs.push({
            rawUrl: def.url,
            urlStart: def.start,
            urlEnd: def.end,
          });
        }
        i = labelClose + 1;
        continue;
      }
      i += 1;
    }
  }

  return refs;
}

/** Rewrite remote image URL tokens to local paths; preserve titles / definition tails. */
export function rewriteMarkdownRemoteImageUrls(
  body: string,
  replacements: ReadonlyMap<string, string>,
  knownRefs?: readonly MarkdownRemoteImageRef[],
): string {
  if (replacements.size === 0) {
    return body;
  }
  const refs = knownRefs ?? extractMarkdownRemoteImageRefs(body);
  if (refs.length === 0) {
    return body;
  }
  // Dedupe by span so shared reference definitions are rewritten once.
  const uniqueRefs: MarkdownRemoteImageRef[] = [];
  const seenSpans = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.urlStart}:${ref.urlEnd}`;
    if (seenSpans.has(key)) {
      continue;
    }
    seenSpans.add(key);
    uniqueRefs.push(ref);
  }

  let out = body;
  for (let index = uniqueRefs.length - 1; index >= 0; index -= 1) {
    const ref = uniqueRefs[index]!;
    const local = replacements.get(ref.rawUrl);
    if (!local) {
      continue;
    }
    const span = out.slice(ref.urlStart, ref.urlEnd);
    if (!span.includes(ref.rawUrl)) {
      continue;
    }
    out = `${out.slice(0, ref.urlStart)}${span.replace(ref.rawUrl, local)}${out.slice(ref.urlEnd)}`;
  }
  return out;
}

export function filenameFromRemoteImageUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(normalizeRemoteHttpUrl(url)).pathname;
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
) => Promise<GeneratedCover>;

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
  const fetchUrl = normalizeRemoteHttpUrl(url);
  try {
    return await fetchBytes(fetchUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `localizeRemoteDisplayAssets: failed to download ${role} from ${fetchUrl}: ${message}`,
      { cause: error },
    );
  }
}

function documentFrontmatter(
  known: object,
  properties: Record<string, unknown>,
  options?: { clearThumbnail?: boolean },
): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = { ...properties };
  for (const [key, value] of Object.entries(known)) {
    if (value === undefined) {
      continue;
    }
    if (options?.clearThumbnail && key === "thumbnail") {
      continue;
    }
    frontmatter[key] = value;
  }
  if (options?.clearThumbnail) {
    frontmatter.thumbnail = null;
  }
  return frontmatter;
}

function bodyMightContainRemoteImage(body: string): boolean {
  return (
    /https?:\/\//i.test(body) ||
    /\]\(\s*\/\//.test(body) ||
    /\]:\s*https?:\/\//i.test(body) ||
    /\]:\s*\/\//.test(body)
  );
}

/** Cheap pre-check before enqueueing async localize (#768). */
export function mightNeedRemoteDisplayAssetLocalization(
  rawMarkdown: string,
  itemUrl?: string | null,
): boolean {
  const parsed = parseDocumentMarkdown(rawMarkdown);
  const { known } = partitionDocumentFrontmatter(parsed.frontmatter);
  const fmThumbnail =
    typeof known.thumbnail === "string" ? known.thumbnail : null;
  const needsFmThumbnail = Boolean(fmThumbnail && isRemoteHttpUrl(fmThumbnail));
  const resolvedItemUrl =
    itemUrl !== undefined
      ? itemUrl
      : typeof known.url === "string"
        ? known.url
        : null;
  const teaserUrl = resolvedItemUrl
    ? youtubeTeaserDownloadUrl(resolvedItemUrl)
    : null;
  return (
    needsFmThumbnail ||
    Boolean(teaserUrl) ||
    bodyMightContainRemoteImage(parsed.body)
  );
}

/**
 * Download remote markdown images + FM thumbnail + YouTube teaser into note media.
 * Rewrites the document to local paths. Fails hard on any download error (#739).
 * Downloads complete before any attach; attached media is cleaned up on failure.
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

  const fmThumbnail =
    typeof known.thumbnail === "string" ? known.thumbnail : null;
  const needsFmThumbnail = Boolean(fmThumbnail && isRemoteHttpUrl(fmThumbnail));
  const itemUrl =
    options.itemUrl !== undefined
      ? options.itemUrl
      : typeof known.url === "string"
        ? known.url
        : null;
  const teaserUrl = itemUrl ? youtubeTeaserDownloadUrl(itemUrl) : null;
  const needsBodyScan = bodyMightContainRemoteImage(parsed.body);

  if (!needsFmThumbnail && !teaserUrl && !needsBodyScan) {
    return { text: options.rawMarkdown, changed: false };
  }

  let body = parsed.body;
  let changed = false;

  const remoteImageRefs = needsBodyScan
    ? extractMarkdownRemoteImageRefs(body)
    : [];
  const uniqueRemoteUrls = [...new Set(remoteImageRefs.map((r) => r.rawUrl))];

  const downloadedImages = new Map<string, Uint8Array>();
  for (const remoteUrl of uniqueRemoteUrls) {
    downloadedImages.set(
      remoteUrl,
      await downloadOrThrow(fetchBytes, remoteUrl, "markdown image"),
    );
  }

  let fmThumbnailBytes: Uint8Array | null = null;
  if (needsFmThumbnail && fmThumbnail) {
    fmThumbnailBytes = await downloadOrThrow(
      fetchBytes,
      fmThumbnail,
      "frontmatter thumbnail",
    );
  }

  let teaserBytes: Uint8Array | null = null;
  if (teaserUrl && !fmThumbnailBytes) {
    const hasCover = await ctx.fs.exists(itemCoverPath(vaultPath, itemId));
    if (!hasCover) {
      teaserBytes = await downloadOrThrow(
        fetchBytes,
        teaserUrl,
        "YouTube teaser",
      );
    }
  }

  const attachedMediaIds: string[] = [];
  const urlToLocal = new Map<string, string>();

  try {
    for (const [remoteUrl, bytes] of downloadedImages) {
      const filename = filenameFromRemoteImageUrl(remoteUrl);
      const media = await attachMediaFile(ctx, vaultPath, itemId, {
        filename,
        data: bytes,
        mediaType: inferMediaType(filename),
      });
      attachedMediaIds.push(media.id);
      urlToLocal.set(
        remoteUrl,
        mediaFilePath(vaultPath, itemId, media.id, media.filename),
      );
    }

    if (urlToLocal.size > 0) {
      const nextBody = rewriteMarkdownRemoteImageUrls(
        body,
        urlToLocal,
        remoteImageRefs,
      );
      if (nextBody !== body) {
        body = nextBody;
        changed = true;
      }
    }

    let clearThumbnail = false;
    if (fmThumbnailBytes && fmThumbnail) {
      const filename = filenameFromRemoteImageUrl(fmThumbnail);
      const cover = await encodeCoverWebp(fmThumbnailBytes, filename);
      await applyItemCover(
        ctx,
        vaultPath,
        vaultId,
        itemId,
        cover.data,
        cover.size,
      );
      clearThumbnail = true;
      changed = true;
    } else if (teaserBytes) {
      const cover = await encodeCoverWebp(teaserBytes, "mqdefault.jpg");
      await applyItemCover(
        ctx,
        vaultPath,
        vaultId,
        itemId,
        cover.data,
        cover.size,
      );
      changed = true;
    }

    if (!changed) {
      return { text: options.rawMarkdown, changed: false };
    }

    return {
      text: serializeDocumentMarkdown(
        documentFrontmatter(known, properties, { clearThumbnail }),
        body,
      ),
      changed: true,
    };
  } catch (error) {
    for (const mediaId of attachedMediaIds) {
      try {
        await deleteMediaFile(ctx, vaultPath, itemId, mediaId);
      } catch (cleanupError) {
        console.error("localizeRemoteDisplayAssets: cleanup failed", {
          itemId,
          mediaId,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
    }
    throw error;
  }
}
