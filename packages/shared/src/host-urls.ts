/**
 * Host HTTP URL helpers shared by UI, client transport, and domain host (#550 E).
 */

/** Build authenticated host media URL for an absolute vault file path. */
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

/**
 * Derive WS `/api/events` URL from an http(s) base URL.
 * Throws when `baseUrl` is not http(s).
 */
export function deriveWsEventsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.startsWith("https://")) {
    return `${base.replace(/^https:/, "wss:")}/api/events`;
  }
  if (base.startsWith("http://")) {
    return `${base.replace(/^http:/, "ws:")}/api/events`;
  }
  throw new Error(`baseUrl must be http(s): ${baseUrl}`);
}
