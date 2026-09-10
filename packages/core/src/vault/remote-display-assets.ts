/**
 * Localize remote display assets into the note media folder (#739).
 *
 * Product rule: covers, gallery files, and media links in the note body
 * (`![](…)`, `[text](media)`, bare media URLs) must live on disk under
 * `media/<noteUuid>/`. Remote http(s) is never a valid standing display source.
 * `item.url` (content link) may remain remote.
 */

import {
  inferMediaType,
  sanitizeMediaFilename,
  type GeneratedCover,
} from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import {
  DISK_ITEM_READ_CONCURRENCY,
  runWithConcurrency,
} from "../util/concurrency.js";
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

export type MarkdownRemoteMediaRefKind = "imageEmbed" | "link" | "bare";

export interface MarkdownRemoteImageRef {
  /** Exact destination URL token as written (may include HTML entities). */
  rawUrl: string;
  /** Decoded URL used for fetch + media classification. */
  fetchUrl: string;
  kind: MarkdownRemoteMediaRefKind;
  /** Start index of the destination URL span inside `body`. */
  urlStart: number;
  /** End index (exclusive) of the destination URL span inside `body`. */
  urlEnd: number;
  /** Full construct to replace for `link` / `bare` (URL span for `imageEmbed`). */
  replaceStart: number;
  replaceEnd: number;
  /** Link label when `kind === "link"`. */
  linkText?: string;
}

const MEDIA_PATH_EXT =
  /\.(png|jpe?g|gif|webp|avif|mp4|webm|mov)(?:$|[?#])/i;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function isRedditMediaCdnHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "i.redd.it" ||
    h === "v.redd.it" ||
    h === "preview.redd.it" ||
    h === "external-preview.redd.it" ||
    h === "i.redditmedia.com" ||
    h.endsWith(".redditmedia.com")
  );
}

/**
 * True when a remote URL is a downloadable display asset (image/video file),
 * not a normal content page link.
 */
export function isRemoteMediaUrl(value: string): boolean {
  if (!isRemoteHttpUrl(value)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(normalizeRemoteHttpUrl(decodeHtmlEntities(value.trim())));
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  // Bare v.redd.it/{id} is a player page — not attachable media bytes.
  if (
    host === "v.redd.it" &&
    /^\/[^/?#]+\/?$/.test(parsed.pathname) &&
    !MEDIA_PATH_EXT.test(parsed.pathname)
  ) {
    return false;
  }
  if (MEDIA_PATH_EXT.test(parsed.pathname)) {
    return true;
  }
  return isRedditMediaCdnHost(host);
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

function mediaRefFromRawUrl(
  rawUrl: string,
  urlStart: number,
  urlEnd: number,
  kind: MarkdownRemoteMediaRefKind,
  extra?: { replaceStart: number; replaceEnd: number; linkText?: string },
): MarkdownRemoteImageRef | null {
  if (!isRemoteMediaUrl(rawUrl)) {
    return null;
  }
  return {
    rawUrl,
    fetchUrl: decodeHtmlEntities(rawUrl),
    kind,
    urlStart,
    urlEnd,
    replaceStart: extra?.replaceStart ?? urlStart,
    replaceEnd: extra?.replaceEnd ?? urlEnd,
    linkText: extra?.linkText,
  };
}

function parseParenDestination(
  body: string,
  urlStart: number,
): { urlEnd: number; rawUrl: string } | null {
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
    return null;
  }
  const rawUrl = parseDestinationUrl(body.slice(urlStart, j));
  if (!rawUrl) {
    return null;
  }
  return { urlEnd: j, rawUrl };
}

function markCovered(covered: boolean[], start: number, end: number): void {
  const lo = Math.max(0, start);
  const hi = Math.min(covered.length, end);
  for (let i = lo; i < hi; i += 1) {
    covered[i] = true;
  }
}

function isCovered(covered: boolean[], start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    if (covered[i]) {
      return true;
    }
  }
  return false;
}

function remoteUrlSchemeLength(body: string, index: number): number {
  const slice = body.slice(index, index + 8).toLowerCase();
  if (slice.startsWith("https://")) {
    return 8;
  }
  if (slice.startsWith("http://")) {
    return 7;
  }
  if (body.startsWith("//", index)) {
    return 2;
  }
  return 0;
}

function scanBareMediaUrl(
  body: string,
  start: number,
): { rawUrl: string; urlStart: number; urlEnd: number } | null {
  const schemeLen = remoteUrlSchemeLength(body, start);
  if (schemeLen === 0) {
    return null;
  }
  if (start > 0) {
    const prev = body[start - 1]!;
    if (/[A-Za-z0-9/_-]/.test(prev)) {
      return null;
    }
  }
  let end = start + schemeLen;
  while (end < body.length) {
    const ch = body[end]!;
    if (
      ch === " " ||
      ch === "\t" ||
      ch === "\n" ||
      ch === "\r" ||
      ch === ")" ||
      ch === "]" ||
      ch === "<" ||
      ch === ">" ||
      ch === '"' ||
      ch === "'"
    ) {
      break;
    }
    end += 1;
  }
  while (end > start + schemeLen) {
    const last = body[end - 1]!;
    if (last === "." || last === "," || last === ";" || last === "!" || last === ":") {
      end -= 1;
      continue;
    }
    break;
  }
  const rawUrl = body.slice(start, end);
  if (!isRemoteMediaUrl(rawUrl)) {
    return null;
  }
  return { rawUrl, urlStart: start, urlEnd: end };
}

/**
 * Collect remote media destinations: `![…](http…)`, `[text](media)`, bare media
 * URLs, and reference-style image defs (code fences skipped).
 */
export function extractMarkdownRemoteImageRefs(
  body: string,
): MarkdownRemoteImageRef[] {
  const refs: MarkdownRemoteImageRef[] = [];
  const covered = Array.from({ length: body.length }, () => false);
  const definitions = new Map<
    string,
    { url: string; start: number; end: number }
  >();

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
          if (label && url && isRemoteMediaUrl(url)) {
            definitions.set(label, { url, start: valueStart, end: valueEnd });
            markCovered(covered, valueStart, valueEnd);
          }
          i = valueEnd;
          continue;
        }
      }
      i += 1;
    }
  }

  // Pass 2: image embeds + media hyperlinks.
  {
    let i = 0;
    while (i < body.length) {
      const fence = isFenceOpener(body, i);
      if (fence) {
        markCovered(covered, i, findFenceClose(body, fence.end, fence.marker));
        i = findFenceClose(body, fence.end, fence.marker);
        continue;
      }
      if (body[i] === "`") {
        const next = skipInlineCode(body, i);
        markCovered(covered, i, next);
        i = next;
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
          const dest = parseParenDestination(body, urlStart);
          if (!dest) {
            i += 1;
            continue;
          }
          const ref = mediaRefFromRawUrl(
            dest.rawUrl,
            urlStart,
            dest.urlEnd,
            "imageEmbed",
          );
          if (ref) {
            refs.push(ref);
            markCovered(covered, urlStart, dest.urlEnd);
          }
          i = dest.urlEnd + 1;
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
            const ref = mediaRefFromRawUrl(
              def.url,
              def.start,
              def.end,
              "imageEmbed",
            );
            if (ref) {
              refs.push(ref);
            }
          }
          i = refClose + 1;
          continue;
        }
        const shortcut = body.slice(i + 2, labelClose).trim().toLowerCase();
        const def = definitions.get(shortcut);
        if (def && (after === undefined || /\s/.test(after) || after === "\n")) {
          const ref = mediaRefFromRawUrl(
            def.url,
            def.start,
            def.end,
            "imageEmbed",
          );
          if (ref) {
            refs.push(ref);
          }
        }
        i = labelClose + 1;
        continue;
      }
      if (body[i] === "[" && (i === 0 || body[i - 1] !== "!")) {
        const labelClose = body.indexOf("]", i + 1);
        if (
          labelClose !== -1 &&
          body[labelClose + 1] === "(" &&
          !body.slice(i + 1, labelClose).includes("\n")
        ) {
          const linkText = body.slice(i + 1, labelClose);
          const urlStart = labelClose + 2;
          const dest = parseParenDestination(body, urlStart);
          if (dest) {
            const ref = mediaRefFromRawUrl(
              dest.rawUrl,
              urlStart,
              dest.urlEnd,
              "link",
              {
                replaceStart: i,
                replaceEnd: dest.urlEnd + 1,
                linkText,
              },
            );
            if (ref) {
              refs.push(ref);
              markCovered(covered, i, dest.urlEnd + 1);
            }
            i = dest.urlEnd + 1;
            continue;
          }
        }
      }
      i += 1;
    }
  }

  // Pass 3: bare media URLs outside covered spans / code.
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
      if (covered[i]) {
        i += 1;
        continue;
      }
      const bare = scanBareMediaUrl(body, i);
      if (bare && !isCovered(covered, bare.urlStart, bare.urlEnd)) {
        const ref = mediaRefFromRawUrl(
          bare.rawUrl,
          bare.urlStart,
          bare.urlEnd,
          "bare",
          { replaceStart: bare.urlStart, replaceEnd: bare.urlEnd },
        );
        if (ref) {
          refs.push(ref);
          markCovered(covered, bare.urlStart, bare.urlEnd);
        }
        i = bare.urlEnd;
        continue;
      }
      i += 1;
    }
  }

  refs.sort((a, b) => a.replaceStart - b.replaceStart || a.urlStart - b.urlStart);
  return refs;
}

/** Rewrite remote media URL constructs to local image embeds / paths. */
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
  const uniqueRefs: MarkdownRemoteImageRef[] = [];
  const seenSpans = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.replaceStart}:${ref.replaceEnd}:${ref.kind}`;
    if (seenSpans.has(key)) {
      continue;
    }
    seenSpans.add(key);
    uniqueRefs.push(ref);
  }
  // Rewrite from the end of the document so earlier indices stay valid.
  uniqueRefs.sort((a, b) => b.replaceStart - a.replaceStart);

  let out = body;
  for (const ref of uniqueRefs) {
    const local = replacements.get(ref.rawUrl);
    if (!local) {
      continue;
    }
    if (ref.kind === "imageEmbed") {
      const span = out.slice(ref.urlStart, ref.urlEnd);
      if (!span.includes(ref.rawUrl)) {
        continue;
      }
      out = `${out.slice(0, ref.urlStart)}${span.replace(ref.rawUrl, local)}${out.slice(ref.urlEnd)}`;
      continue;
    }
    if (ref.kind === "bare") {
      out = `${out.slice(0, ref.replaceStart)}![](${local})${out.slice(ref.replaceEnd)}`;
      continue;
    }
    // link → ![text](local)
    const alt = ref.linkText ?? "";
    out = `${out.slice(0, ref.replaceStart)}![${alt}](${local})${out.slice(ref.replaceEnd)}`;
  }
  return out;
}

export function filenameFromRemoteImageUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(
      normalizeRemoteHttpUrl(decodeHtmlEntities(url)),
    ).pathname;
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
  const fetchUrl = normalizeRemoteHttpUrl(decodeHtmlEntities(url));
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
 * Download remote markdown media + FM thumbnail + YouTube teaser into note media.
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
  const uniqueFetchUrls = [
    ...new Set(remoteImageRefs.map((r) => r.fetchUrl)),
  ];

  const downloadedBytes = await runWithConcurrency(
    uniqueFetchUrls.length,
    DISK_ITEM_READ_CONCURRENCY,
    (index) =>
      downloadOrThrow(
        fetchBytes,
        uniqueFetchUrls[index]!,
        "markdown image",
      ),
  );

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
  const fetchUrlToLocal = new Map<string, string>();
  const urlToLocal = new Map<string, string>();

  try {
    for (let i = 0; i < uniqueFetchUrls.length; i += 1) {
      const fetchUrl = uniqueFetchUrls[i]!;
      const bytes = downloadedBytes[i]!;
      const filename = filenameFromRemoteImageUrl(fetchUrl);
      const media = await attachMediaFile(ctx, vaultPath, itemId, {
        filename,
        data: bytes,
        mediaType: inferMediaType(filename),
      });
      attachedMediaIds.push(media.id);
      const localPath = mediaFilePath(
        vaultPath,
        itemId,
        media.id,
        media.filename,
      );
      fetchUrlToLocal.set(fetchUrl, localPath);
    }

    for (const ref of remoteImageRefs) {
      const local = fetchUrlToLocal.get(ref.fetchUrl);
      if (local) {
        urlToLocal.set(ref.rawUrl, local);
      }
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
