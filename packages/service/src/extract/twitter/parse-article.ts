/**
 * Parse X Article HTML into TwitterFetchSuccess (#954).
 * Body is markdown from DraftJS blocks (links + media in place).
 * Media attachments from article media_entities — never Open Graph.
 */

import { asRecord, parseJsonObject } from "../json-unknown.js";
import { isTwitterMediaCdnUrl } from "./parse-status.js";
import { canonicalArticleUrl } from "./url.js";
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
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/&nbsp;/g, " ");
}

function unescapeJsString(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function extractMetaContent(html: string, property: string): string | null {
  if (property === "og:image" || property.startsWith("og:image:")) {
    return null;
  }
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  const match = re.exec(html) ?? alt.exec(html);
  return match?.[1] ? decodeHtmlEntities(match[1]) : null;
}

function extractTitleTag(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (!match?.[1]) {
    return null;
  }
  return decodeHtmlEntities(match[1].trim());
}

function extractCollectorArticleBlock(html: string): {
  title: string | null;
  text: string | null;
  media: TwitterFetchedMedia[];
} | null {
  const match =
    /<script[^>]+id=["']collector-twitter-article["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      html,
    );
  if (!match?.[1]) {
    return null;
  }
  const json = parseJsonObject(match[1].trim());
  if (!json) {
    return null;
  }
  const title = asString(json.title);
  const text = asString(json.text) ?? asString(json.body);
  const media: TwitterFetchedMedia[] = [];
  if (Array.isArray(json.media)) {
    for (const entry of json.media) {
      const rec = asRecord(entry);
      if (!rec) {
        continue;
      }
      const url = asString(rec.url);
      if (url === null || !isTwitterMediaCdnUrl(url)) {
        continue;
      }
      const kind = asString(rec.kind) === "video" ? "video" : "image";
      media.push({ kind, url });
    }
  }
  return { title, text, media };
}

type ArticleEntity =
  | { type: "MEDIA"; mediaIds: string[] }
  | { type: "LINK"; url: string }
  | { type: "MARKDOWN"; markdown: string };

type ArticleEntityRange = {
  key: string;
  offset: number;
  length: number;
};

type ArticleBlock = {
  text: string;
  type: string;
  entityRanges: ArticleEntityRange[];
};

function extractBalancedArray(source: string, startIdx: number): string | null {
  return extractBalanced(source, startIdx, "[", "]");
}

function extractBalancedObject(source: string, startIdx: number): string | null {
  return extractBalanced(source, startIdx, "{", "}");
}

function extractBalanced(
  source: string,
  startIdx: number,
  open: "[" | "{",
  close: "]" | "}",
): string | null {
  if (source[startIdx] !== open) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < source.length; i += 1) {
    const ch = source[i]!;
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
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

function parseMediaIdToMedia(
  html: string,
): Map<string, TwitterFetchedMedia> {
  const map = new Map<string, TwitterFetchedMedia>();

  for (const match of html.matchAll(
    /media_id:"(\d+)",media_info:\$R\[\d+\]=\{__typename:"ApiImage"[^}]*?original_img_url:"(https:\/\/pbs\.twimg\.com\/media\/[^"]+)"/g,
  )) {
    const id = match[1];
    const url = match[2];
    if (id && url && isTwitterMediaCdnUrl(url)) {
      map.set(id, { kind: "image", url });
    }
  }

  for (const block of html.matchAll(
    /media_id:"(\d+)",media_info:\$R\[\d+\]=\{__typename:"ApiVideo"([\s\S]{0,2500}?)(?=media_id:"|cover_media_results:|media_entities:|$)/g,
  )) {
    const id = block[1];
    const chunk = block[2] ?? "";
    if (!id) {
      continue;
    }
    let bestUrl: string | null = null;
    let bestBitrate = -1;
    for (const variant of chunk.matchAll(
      /bit_rate:(null|\d+),content_type:"video\/mp4",url:"(https:\/\/video\.twimg\.com\/[^"]+\.mp4[^"]*)"/g,
    )) {
      const bitrate =
        variant[1] === "null" || variant[1] === undefined
          ? 0
          : Number(variant[1]);
      const url = variant[2] ?? null;
      if (url !== null && bitrate >= bestBitrate) {
        bestBitrate = bitrate;
        bestUrl = url;
      }
    }
    if (bestUrl !== null && isTwitterMediaCdnUrl(bestUrl)) {
      map.set(id, { kind: "video", url: bestUrl });
    }
  }

  return map;
}

function parseEntityMap(html: string): Map<string, ArticleEntity> {
  const map = new Map<string, ArticleEntity>();
  const marker = "entity_map:";
  const markerIdx = html.indexOf(marker);
  if (markerIdx < 0) {
    return map;
  }
  const eq = html.indexOf("=[", markerIdx);
  if (eq < 0) {
    return map;
  }
  const arr = extractBalancedArray(html, eq + 1);
  if (arr === null) {
    return map;
  }

  for (const entry of arr.matchAll(
    /\{key:"(\d+)",value:\$R\[\d+\]=\{type:"([A-Z_]+)",data:\$R\[\d+\]=\{([\s\S]*?)\}\}\}/g,
  )) {
    const key = entry[1];
    const type = entry[2];
    const data = entry[3] ?? "";
    if (!key || !type) {
      continue;
    }
    if (type === "LINK") {
      const url = /url:"(https?:\/\/[^"]+)"/.exec(data)?.[1];
      if (url) {
        map.set(key, { type: "LINK", url });
      }
      continue;
    }
    if (type === "MARKDOWN") {
      const md = /markdown:"((?:\\.|[^"\\])*)"/.exec(data)?.[1];
      if (md !== undefined) {
        map.set(key, { type: "MARKDOWN", markdown: unescapeJsString(md) });
      }
      continue;
    }
    if (type === "MEDIA") {
      const mediaIds = [
        ...data.matchAll(/media_id:"(\d+)"/g),
      ].map((m) => m[1]!);
      if (mediaIds.length > 0) {
        map.set(key, { type: "MEDIA", mediaIds });
      }
    }
  }
  return map;
}

function parseContentBlocks(html: string): ArticleBlock[] {
  const entityIdx = html.indexOf("entity_map:");
  const searchEnd = entityIdx > 0 ? entityIdx : html.length;
  const region = html.slice(0, searchEnd);
  const markerIdx = region.lastIndexOf("blocks:");
  if (markerIdx < 0) {
    return [];
  }
  const eq = region.indexOf("=[", markerIdx);
  if (eq < 0) {
    return [];
  }
  const arr = extractBalancedArray(region, eq + 1);
  if (arr === null) {
    return [];
  }

  const blocks: ArticleBlock[] = [];
  // data may nest urls/mentions objects — do not use [^}]*; balance braces.
  const blockStart =
    /\{key:"[^"]*",text:"((?:\\.|[^"\\])*)",type:"([a-z0-9-]+)",data:\$R\[\d+\]=/g;
  let match: RegExpExecArray | null;
  while ((match = blockStart.exec(arr)) !== null) {
    const dataObj = extractBalancedObject(arr, match.index + match[0].length);
    if (dataObj === null) {
      continue;
    }
    const afterData = match.index + match[0].length + dataObj.length;
    const erPrefix = /^,entity_ranges:\$R\[\d+\]=/.exec(arr.slice(afterData));
    if (erPrefix === null) {
      continue;
    }
    const rangesArr = extractBalancedArray(
      arr,
      afterData + erPrefix[0].length,
    );
    const entityRanges: ArticleEntityRange[] = [
      ...(rangesArr ?? "").matchAll(
        /\{key:(\d+),length:(\d+),offset:(\d+)\}/g,
      ),
    ].map((m) => ({
      key: m[1]!,
      length: Number(m[2]),
      offset: Number(m[3]),
    }));
    blocks.push({
      text: unescapeJsString(match[1] ?? ""),
      type: match[2] ?? "unstyled",
      entityRanges,
    });
  }
  return blocks;
}

/**
 * Apply DraftJS LINK entity_ranges by offset/length (end→start so offsets stay valid).
 */
function applyInlineLinkRanges(
  text: string,
  ranges: readonly ArticleEntityRange[],
  entities: Map<string, ArticleEntity>,
  usedLinkUrls: Set<string>,
): string {
  const linkRanges = ranges
    .filter((range) => entities.get(range.key)?.type === "LINK")
    .sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const range of linkRanges) {
    const entity = entities.get(range.key);
    if (entity?.type !== "LINK") {
      continue;
    }
    if (
      range.offset < 0 ||
      range.length <= 0 ||
      range.offset + range.length > out.length
    ) {
      continue;
    }
    const label = out.slice(range.offset, range.offset + range.length);
    const md = `[${label}](${entity.url})`;
    out =
      out.slice(0, range.offset) +
      md +
      out.slice(range.offset + range.length);
    usedLinkUrls.add(entity.url);
  }
  return out;
}

function renderBlockMarkdown(
  block: ArticleBlock,
  entities: Map<string, ArticleEntity>,
  mediaById: Map<string, TwitterFetchedMedia>,
  usedLinkUrls: Set<string>,
): string {
  if (block.type === "atomic") {
    const parts: string[] = [];
    for (const range of block.entityRanges) {
      const entity = entities.get(range.key);
      if (!entity) {
        continue;
      }
      if (entity.type === "LINK") {
        parts.push(`[${entity.url}](${entity.url})`);
        usedLinkUrls.add(entity.url);
        continue;
      }
      if (entity.type === "MARKDOWN") {
        parts.push(entity.markdown.trim());
        continue;
      }
      if (entity.type === "MEDIA") {
        for (const mediaId of entity.mediaIds) {
          const media = mediaById.get(mediaId);
          if (!media) {
            continue;
          }
          parts.push(`![](${media.url})`);
        }
      }
    }
    return parts.join("\n\n");
  }

  const text = applyInlineLinkRanges(
    block.text.trimEnd(),
    block.entityRanges,
    entities,
    usedLinkUrls,
  );

  switch (block.type) {
    case "header-one":
      return `# ${text}`;
    case "header-two":
      return `## ${text}`;
    case "header-three":
      return `### ${text}`;
    case "unordered-list-item":
      return `- ${text}`;
    case "ordered-list-item":
      return `1. ${text}`;
    case "blockquote":
      return text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    default:
      return text;
  }
}

/**
 * Build markdown body from X Article DraftJS payload (blocks + entity_map).
 * Preserves links and in-body media references.
 */
export function buildArticleMarkdownFromPayload(html: string): string | null {
  const blocks = parseContentBlocks(html);
  if (blocks.length === 0) {
    return null;
  }
  const entities = parseEntityMap(html);
  const mediaById = parseMediaIdToMedia(html);
  const parts: string[] = [];
  const usedLinkUrls = new Set<string>();

  for (const block of blocks) {
    const rendered = renderBlockMarkdown(
      block,
      entities,
      mediaById,
      usedLinkUrls,
    ).trim();
    if (rendered.length === 0) {
      continue;
    }
    parts.push(rendered);
  }

  let markdown = parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  markdown = linkifyBareHosts(markdown, entities, usedLinkUrls);

  const orphanLinks: string[] = [];
  for (const entity of entities.values()) {
    if (entity.type !== "LINK") {
      continue;
    }
    if (usedLinkUrls.has(entity.url) || markdown.includes(entity.url)) {
      continue;
    }
    orphanLinks.push(`- [${entity.url}](${entity.url})`);
    usedLinkUrls.add(entity.url);
  }
  if (orphanLinks.length > 0) {
    markdown = `${markdown}\n\n## Links\n\n${orphanLinks.join("\n")}`;
  }

  return markdown.length > 0 ? markdown : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linkifyBareHosts(
  markdown: string,
  entities: Map<string, ArticleEntity>,
  usedLinkUrls: Set<string>,
): string {
  let out = markdown;
  for (const entity of entities.values()) {
    if (entity.type !== "LINK") {
      continue;
    }
    if (usedLinkUrls.has(entity.url) || out.includes(entity.url)) {
      continue;
    }
    let host: string;
    try {
      host = new URL(entity.url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    // Only plain host tokens — never inside an existing markdown URL `](...)`.
    const re = new RegExp(
      `(?<![\\w/=.\\]])(?<!\\]\\([^)\\s]*)${escapeRegExp(host)}(?![\\w.])`,
      "gi",
    );
    const next = out.replace(re, `[${host}](${entity.url})`);
    if (next === out) {
      continue;
    }
    out = next;
    usedLinkUrls.add(entity.url);
  }
  return out;
}

/**
 * Media from article media_entities / ApiImage+ApiVideo, in document order
 * when possible via entity_map MEDIA keys appearing in blocks.
 */
export function extractArticleEmbeddedMedia(
  html: string,
): TwitterFetchedMedia[] {
  const mediaById = parseMediaIdToMedia(html);
  const entities = parseEntityMap(html);
  const blocks = parseContentBlocks(html);
  const ordered: TwitterFetchedMedia[] = [];
  const seen = new Set<string>();

  const push = (media: TwitterFetchedMedia | undefined) => {
    if (!media || seen.has(media.url)) {
      return;
    }
    seen.add(media.url);
    ordered.push(media);
  };

  for (const block of blocks) {
    for (const range of block.entityRanges) {
      const entity = entities.get(range.key);
      if (entity?.type !== "MEDIA") {
        continue;
      }
      for (const id of entity.mediaIds) {
        push(mediaById.get(id));
      }
    }
  }

  // Any remaining media entities not referenced in blocks.
  for (const media of mediaById.values()) {
    push(media);
  }

  return ordered;
}

function fallbackPlainArticleBody(html: string): string | null {
  const articleMatch =
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (!articleMatch?.[1]) {
    return null;
  }
  let body = articleMatch[1];
  // Strip chrome links at bottom / author avatar.
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  // Keep anchors as markdown links before stripping tags.
  body = body.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_full, href: string, inner: string) => {
      const label = decodeHtmlEntities(
        inner.replace(/<[^>]+>/g, "").trim(),
      );
      if (!href.startsWith("http") || label.length === 0) {
        return label;
      }
      const isProfile =
        /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/?$/i.test(href);
      if (
        href === "https://x.com/" ||
        href === "https://twitter.com/" ||
        href.endsWith("/search") ||
        isProfile
      ) {
        return label;
      }
      return `[${label}](${href})`;
    },
  );
  body = body.replace(
    /<img\b[^>]+src=["'](https:\/\/pbs\.twimg\.com\/media\/[^"']+)["'][^>]*>/gi,
    (_full, src: string) => `\n\n![](${src})\n\n`,
  );
  const stripped = body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped.length > 0 ? decodeHtmlEntities(stripped) : null;
}

/**
 * Parse article page HTML into fetch success with markdown body + media.
 */
export function parseArticleFromHtml(
  html: string,
  articleId: string,
  username: string | null,
  sourceUrl?: string,
): TwitterFetchSuccess | null {
  const block = extractCollectorArticleBlock(html);
  const title =
    block?.title ??
    extractMetaContent(html, "og:title") ??
    extractTitleTag(html);

  const text =
    block?.text ??
    buildArticleMarkdownFromPayload(html) ??
    fallbackPlainArticleBody(html) ??
    extractMetaContent(html, "og:description");

  const mediaFromPayload =
    block?.media && block.media.length > 0
      ? block.media
      : extractArticleEmbeddedMedia(html);

  if ((text === null || text.trim().length === 0) && mediaFromPayload.length === 0) {
    return null;
  }
  if (text === null || text.trim().length === 0) {
    return null;
  }

  // HTML / markdown fallbacks can embed `![](pbs…)` without DraftJS media_entities.
  // Union those CDN URLs into media so the plugin downloads in one pass.
  const media = mergeFetchedMedia(
    mediaFromPayload,
    collectTwitterCdnMediaFromMarkdown(text),
  );

  return {
    kind: "article",
    sourceUrl: sourceUrl ?? canonicalArticleUrl(articleId, username),
    contentId: articleId,
    authorUsername: username,
    title,
    text,
    media,
  };
}

function mergeFetchedMedia(
  primary: TwitterFetchedMedia[],
  extra: TwitterFetchedMedia[],
): TwitterFetchedMedia[] {
  const out: TwitterFetchedMedia[] = [];
  const seen = new Set<string>();
  for (const entry of [...primary, ...extra]) {
    if (seen.has(entry.url)) {
      continue;
    }
    seen.add(entry.url);
    out.push(entry);
  }
  return out;
}

/** Pull Twitter CDN URLs already present as markdown image embeds. */
export function collectTwitterCdnMediaFromMarkdown(
  markdown: string,
): TwitterFetchedMedia[] {
  const out: TwitterFetchedMedia[] = [];
  const seen = new Set<string>();
  const re = /!\[[^\]]*]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const url = match[1]!;
    if (seen.has(url) || !isTwitterMediaCdnUrl(url)) {
      continue;
    }
    seen.add(url);
    out.push({
      kind: url.includes("video.twimg.com") ? "video" : "image",
      url,
    });
  }
  return out;
}
