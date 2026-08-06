/**
 * Browser/dev URLs stay as-is; absolute disk paths go through host `/media/file`
 * when the UI is dialed to a real domain host (#553 / #555).
 *
 * Do NOT treat every path starting with `/` as a web URL — on Linux absolute
 * filesystem paths look like `/home/...` and must use the media endpoint.
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

export function toDisplayAssetSrc(pathOrUrl: string): string {
  if (
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://") ||
    pathOrUrl.startsWith("blob:") ||
    pathOrUrl.startsWith("data:") ||
    pathOrUrl.startsWith("/__dev/")
  ) {
    return pathOrUrl;
  }
  const host = readHostMediaEnv();
  if (host) {
    return buildHostMediaFileUrl(host.baseUrl, host.token, pathOrUrl);
  }
  return pathOrUrl;
}
