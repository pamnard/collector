/**
 * Display path + slot CSS size → `/media/derive` URL + srcset (#882).
 */

import {
  buildHostMediaDeriveUrl,
  type MediaDeriveWidth,
} from "@collector/shared";
import {
  deriveSrcSetWidthsForSlot,
  neededDeriveWidthForSlot,
} from "../lib/image-slot-fit.ts";
import { getHostMediaCredentials, toDisplayAssetSrc } from "./asset-src.ts";

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

function buildDeriveUrl(
  baseUrl: string,
  token: string,
  absolutePath: string,
  width: MediaDeriveWidth,
): string {
  return buildHostMediaDeriveUrl(baseUrl, token, absolutePath, width);
}

/**
 * Build `<img>` src / srcSet / sizes for a display slot.
 * Without host credentials, falls back to {@link toDisplayAssetSrc} (no derive).
 */
export function buildDerivedImageAttrs(input: {
  displayPath: string;
  slotCssWidthPx: number;
  devicePixelRatio?: number;
  sourceNaturalWidth?: number;
}): DerivedImageAttrs {
  const dpr = input.devicePixelRatio ?? readDevicePixelRatio();
  const sizes = `${Math.round(input.slotCssWidthPx)}px`;
  const absolutePath = absolutePathForMediaDerive(input.displayPath);
  const host = getHostMediaCredentials();

  if (absolutePath === null || host === null) {
    const src = toDisplayAssetSrc(input.displayPath);
    return { src, srcSet: src, sizes };
  }

  const primaryWidth = neededDeriveWidthForSlot({
    slotCssWidthPx: input.slotCssWidthPx,
    devicePixelRatio: dpr,
    sourceNaturalWidth: input.sourceNaturalWidth,
  });
  const src = buildDeriveUrl(host.baseUrl, host.token, absolutePath, primaryWidth);
  const widths = deriveSrcSetWidthsForSlot({
    slotCssWidthPx: input.slotCssWidthPx,
    sourceNaturalWidth: input.sourceNaturalWidth,
  });
  const srcSet = widths
    .map(
      (width) =>
        `${buildDeriveUrl(host.baseUrl, host.token, absolutePath, width)} ${width}w`,
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
