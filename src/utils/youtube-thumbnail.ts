/**
 * YouTube cover URL from an item link. Host-scoped — never match bare `v/` in
 * unrelated paths (e.g. reddit.com/.../aigamedev/comments/... contains `v/`).
 */
export function getYouTubeThumbnail(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const mq = (id: string | null | undefined) =>
    id && /^[\w-]{6,}$/.test(id)
      ? `https://img.youtube.com/vi/${id}/mqdefault.jpg`
      : null;

  if (host === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    return mq(id?.split("?")[0]);
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
    return mq(segments[1] ?? null);
  }

  return mq(parsed.searchParams.get("v"));
}
