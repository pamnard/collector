/**
 * CDN download headers shared by extract plugins (Referer + browser UA).
 */

const CDN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function cdnDownloadHeaders(origin: string): Record<string, string> {
  return {
    Referer: `${origin}/`,
    "User-Agent": CDN_USER_AGENT,
  };
}
