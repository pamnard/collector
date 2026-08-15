import type { ExtractedTextLink } from "./extract-text-links.js";
import { basename, dirname, normalizeRelativePath } from "../vault/paths.js";

export interface TextLinkResolveContext {
  sourceItemId: string;
  idExists: (itemId: string) => boolean;
  /** All item ids whose title equals `title` (exact match). */
  idsByTitle: (title: string) => string[];
}

export interface ResolvedTextLink extends ExtractedTextLink {
  /** Matched item id, or null when missing/ambiguous. */
  resolvedItemId: string | null;
}

/** Strip Obsidian-style `#heading` / `^block` suffixes for resolve. */
export function resolveTargetKey(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  const hash = trimmed.indexOf("#");
  const caret = trimmed.indexOf("^");
  let cut = trimmed.length;
  if (hash !== -1) {
    cut = Math.min(cut, hash);
  }
  if (caret !== -1) {
    cut = Math.min(cut, caret);
  }
  return trimmed.slice(0, cut).trim();
}

/** Resolve `..` / `.` segments inside a vault-relative path. */
export function collapsePathSegments(path: string): string {
  const parts = normalizeRelativePath(path).split("/").filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") {
      continue;
    }
    if (part === "..") {
      if (out.length === 0) {
        continue;
      }
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function candidatePaths(sourceItemId: string, targetKey: string): string[] {
  const key = targetKey.replace(/\\/g, "/").trim();
  if (!key) {
    return [];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const collapsed = collapsePathSegments(value);
    if (!collapsed || seen.has(collapsed)) {
      return;
    }
    seen.add(collapsed);
    candidates.push(collapsed);
  };

  if (key.startsWith("/")) {
    push(key.slice(1));
  } else if (key.startsWith("./") || key.startsWith("../")) {
    const baseDir = dirname(sourceItemId);
    push(baseDir ? `${baseDir}/${key}` : key);
  } else {
    push(key);
    const baseDir = dirname(sourceItemId);
    if (baseDir) {
      push(`${baseDir}/${key}`);
    }
  }

  const withMd: string[] = [];
  for (const candidate of candidates) {
    withMd.push(candidate);
    if (!candidate.toLowerCase().endsWith(".md")) {
      withMd.push(`${candidate}.md`);
    }
  }
  return withMd;
}

/** Titles to try for a resolve key (full key, then path basename — Obsidian-style). */
export function titleResolveCandidates(targetKey: string): string[] {
  const key = targetKey.replace(/\\/g, "/").trim();
  if (!key) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    out.push(trimmed);
    if (trimmed.toLowerCase().endsWith(".md")) {
      const stem = trimmed.slice(0, -3).trim();
      if (stem && !seen.has(stem)) {
        seen.add(stem);
        out.push(stem);
      }
    }
  };
  push(key);
  const base = basename(key);
  if (base !== key) {
    push(base);
  }
  return out;
}

function resolveUniqueTitle(
  context: TextLinkResolveContext,
  targetKey: string,
): string | null {
  for (const title of titleResolveCandidates(targetKey)) {
    const titleHits = context.idsByTitle(title);
    if (titleHits.length === 1) {
      return titleHits[0]!;
    }
  }
  return null;
}

function resolveOne(
  link: ExtractedTextLink,
  context: TextLinkResolveContext,
): ResolvedTextLink {
  const key = resolveTargetKey(link.rawTarget);
  for (const candidate of candidatePaths(context.sourceItemId, key)) {
    if (context.idExists(candidate)) {
      return { ...link, resolvedItemId: candidate };
    }
  }

  const byTitle = resolveUniqueTitle(context, key);
  if (byTitle) {
    return { ...link, resolvedItemId: byTitle };
  }

  return { ...link, resolvedItemId: null };
}

export function resolveTextLinks(
  links: ExtractedTextLink[],
  context: TextLinkResolveContext,
): ResolvedTextLink[] {
  return links.map((link) => resolveOne(link, context));
}
