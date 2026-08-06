import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

/**
 * Browser/dev URLs stay as-is; absolute disk paths go through Tauri convertFileSrc
 * or host `/media/file` when the UI is dialed to a real domain host (#553).
 *
 * Do NOT treat every path starting with `/` as a web URL — on Linux absolute
 * filesystem paths look like `/home/...` and must be converted for the WebView.
 * Outside Tauri (web DevMock) never call convertFileSrc — no IPC bridge.
 */

function readHostMediaEnv(): { baseUrl: string; token: string } | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const baseUrl = String(env.VITE_COLLECTOR_SERVICE_BASE_URL ?? "").trim();
  const token = String(env.VITE_COLLECTOR_SERVICE_TOKEN ?? "").trim();
  if (baseUrl.length === 0 || token.length === 0) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

/** Build authenticated host media URL for an absolute vault file path (#553). */
export function buildHostMediaFileUrl(
  baseUrl: string,
  token: string,
  absolutePath: string,
): string {
  const url = new URL("/media/file", `${baseUrl.replace(/\/+$/, "")}/`);
  url.searchParams.set("path", absolutePath);
  url.searchParams.set("token", token);
  return url.toString();
}

export function toDisplayAssetSrc(pathOrUrl: string): string {
  if (
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://") ||
    pathOrUrl.startsWith("asset:") ||
    pathOrUrl.startsWith("blob:") ||
    pathOrUrl.startsWith("data:") ||
    pathOrUrl.startsWith("/__dev/")
  ) {
    return pathOrUrl;
  }
  if (isTauri()) {
    return convertFileSrc(pathOrUrl);
  }
  const host = readHostMediaEnv();
  if (host) {
    return buildHostMediaFileUrl(host.baseUrl, host.token, pathOrUrl);
  }
  return pathOrUrl;
}
