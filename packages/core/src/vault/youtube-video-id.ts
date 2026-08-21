/**
 * YouTube URL parsing and one-time teaser download URL (#739).
 * Display must not hotlink the CDN — download into cover.webp at ingest/save.
 */

export function isRemoteHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/**
 * YouTube video id from a watch/shorts/youtu.be URL. Host-scoped — never match
 * bare `v/` in unrelated paths.
 */
export function parseYouTubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const valid = (id: string | null | undefined) =>
    id && /^[\w-]{6,}$/.test(id) ? id.split("?")[0]! : null;

  if (host === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    return valid(id);
  }

  const youtubeHosts = new Set([
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
  ]);
  if (!youtubeHosts.has(host)) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const kind = segments[0];
  if (
    kind === "shorts" ||
    kind === "embed" ||
    kind === "v" ||
    kind === "live" ||
    kind === "vi"
  ) {
    return valid(segments[1] ?? null);
  }

  return valid(parsed.searchParams.get("v"));
}

/**
 * CDN teaser URL for a one-time download into local cover.webp.
 * Not for UI display (#739).
 */
export function youtubeTeaserDownloadUrl(itemUrl: string): string | null {
  const id = parseYouTubeVideoId(itemUrl);
  if (!id) {
    return null;
  }
  return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
}
