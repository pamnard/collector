/**
 * Cover slot display: one pipe for hero / grid / related / thumbnail (#876 / #879 / #882).
 *
 * 1. Host resolves the best available bitmap path (cover-source gallery file when
 *    known; otherwise cover.webp — e.g. video poster with no larger still).
 * 2. UI always loads that path through `/media/derive` sized to the CSS slot.
 *
 * Layout reservation (masonry WxH) still uses cover.size.json next to cover.webp.
 * There is no parallel “raw cover.webp in <img>” path for these surfaces.
 */

import { buildHostMediaDeriveUrl } from "@collector/shared";
import {
  deriveSrcSetWidthsForSlot,
  neededDeriveWidthForSlot,
} from "../lib/image-slot-fit.ts";
import { getHostMediaCredentials } from "./asset-src.ts";

export type DerivedImageAttrs = {
  src: string;
  srcSet: string;
  sizes: string;
};

/**
 * Absolute vault path for derive. Accepts disk paths or existing host
 * `/media/file` / `/media/derive` URLs (extracts `path` query).
 */
export function absolutePathForMediaDerive(pathOrUrl: string): string | null {
  if (
    pathOrUrl.startsWith("blob:") ||
    pathOrUrl.startsWith("data:") ||
    pathOrUrl.startsWith("/__dev/")
  ) {
    return null;
  }
  if (
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://")
  ) {
    let parsed: URL;
    try {
      parsed = new URL(pathOrUrl);
    } catch {
      return null;
    }
    if (
      parsed.pathname === "/media/file" ||
      parsed.pathname.endsWith("/media/file") ||
      parsed.pathname === "/media/derive" ||
      parsed.pathname.endsWith("/media/derive")
    ) {
      const path = parsed.searchParams.get("path");
      return path && path.length > 0 ? path : null;
    }
    return null;
  }
  return pathOrUrl;
}

/**
 * Build `<img>` src / srcSet / sizes for a cover display slot via `/media/derive`.
 * Vault paths require host credentials — no silent `/media/file` fallback.
 * Pass `sourceMtimeMs` when known so derive URLs include cache-busting `v`.
 */
export function buildDerivedImageAttrs(input: {
  displayPath: string;
  slotCssWidthPx: number;
  devicePixelRatio?: number;
  sourceNaturalWidth?: number;
  /** Vault file mtime (ms); when set, URLs include `v` for browser cache bust. */
  sourceMtimeMs?: number;
}): DerivedImageAttrs {
  const dpr = input.devicePixelRatio ?? readDevicePixelRatio();
  const sizes = `${Math.round(input.slotCssWidthPx)}px`;
  const absolutePath = absolutePathForMediaDerive(input.displayPath);
  if (absolutePath === null) {
    throw new Error(
      `cover derive requires a vault path or host media URL, got ${input.displayPath}`,
    );
  }
  const host = getHostMediaCredentials();
  if (host === null) {
    throw new Error(
      "host media credentials required for cover /media/derive (#555 / #882)",
    );
  }

  const primaryWidth = neededDeriveWidthForSlot({
    slotCssWidthPx: input.slotCssWidthPx,
    devicePixelRatio: dpr,
    sourceNaturalWidth: input.sourceNaturalWidth,
  });
  const src = buildHostMediaDeriveUrl(
    host.baseUrl,
    host.token,
    absolutePath,
    primaryWidth,
    input.sourceMtimeMs,
  );
  const widths = deriveSrcSetWidthsForSlot({
    slotCssWidthPx: input.slotCssWidthPx,
    sourceNaturalWidth: input.sourceNaturalWidth,
  });
  const srcSet = widths
    .map(
      (width) =>
        `${buildHostMediaDeriveUrl(host.baseUrl, host.token, absolutePath, width, input.sourceMtimeMs)} ${width}w`,
    )
    .join(", ");
  return { src, srcSet, sizes };
}

function readDevicePixelRatio(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  const dpr = window.devicePixelRatio;
  if (!(dpr > 0) || !Number.isFinite(dpr)) {
    throw new Error(`window.devicePixelRatio must be positive, got ${dpr}`);
  }
  return dpr;
}
