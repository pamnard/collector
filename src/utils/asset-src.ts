/**
 * Browser/dev URLs stay as-is; absolute disk paths go through host `/media/file`
 * when the UI is dialed to a real domain host (#553 / #555).
 *
 * Do NOT treat every path starting with `/` as a web URL — on Linux absolute
 * filesystem paths look like `/home/...` and must use the media endpoint.
 *
 * Remote http(s) display assets are forbidden (#739). Only host `/media/file`
 * URLs (already localized) may be http(s).
 */

import { readViteCollectorServiceEnv } from "../services/vite-collector-service-env";
import { buildHostMediaFileUrl } from "@collector/shared";

export { buildHostMediaFileUrl } from "@collector/shared";

let runtimeHostMedia: { baseUrl: string; token: string } | null = null;

/** Set when HTTP host cutover succeeds (Vite env or /api/ui-bootstrap). */
export function setHostMediaCredentials(baseUrl: string, token: string): void {
  const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
  const trimmedToken = token.trim();
  if (!trimmedBase || !trimmedToken) {
    throw new Error("setHostMediaCredentials requires non-empty baseUrl and token (#555)");
  }
  runtimeHostMedia = { baseUrl: trimmedBase, token: trimmedToken };
}

export function clearHostMediaCredentials(): void {
  runtimeHostMedia = null;
}

function readHostMediaEnv(): { baseUrl: string; token: string } | null {
  if (runtimeHostMedia) {
    return runtimeHostMedia;
  }
  const { baseUrl, token } = readViteCollectorServiceEnv();
  if (baseUrl.length === 0 || token.length === 0) {
    return null;
  }
  return { baseUrl, token };
}

function isAllowedHttpDisplaySrc(pathOrUrl: string): boolean {
  if (
    pathOrUrl.startsWith("blob:") ||
    pathOrUrl.startsWith("data:") ||
    pathOrUrl.startsWith("/__dev/")
  ) {
    return true;
  }
  if (
    !pathOrUrl.startsWith("http://") &&
    !pathOrUrl.startsWith("https://")
  ) {
    return true;
  }
  const host = readHostMediaEnv();
  if (!host) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(pathOrUrl);
  } catch {
    return false;
  }
  const base = new URL(host.baseUrl);
  if (parsed.origin !== base.origin) {
    return false;
  }
  return (
    parsed.pathname === "/media/file" ||
    parsed.pathname.endsWith("/media/file")
  );
}

export function toDisplayAssetSrc(pathOrUrl: string): string {
  if (
    pathOrUrl.startsWith("blob:") ||
    pathOrUrl.startsWith("data:") ||
    pathOrUrl.startsWith("/__dev/")
  ) {
    return pathOrUrl;
  }
  if (
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://")
  ) {
    if (!isAllowedHttpDisplaySrc(pathOrUrl)) {
      throw new Error(
        `toDisplayAssetSrc: remote display asset URL is not allowed (#739): ${pathOrUrl}`,
      );
    }
    return pathOrUrl;
  }
  const host = readHostMediaEnv();
  if (host) {
    return buildHostMediaFileUrl(host.baseUrl, host.token, pathOrUrl);
  }
  return pathOrUrl;
}
