export function getYouTubeThumbnail(url: string): string | null {
  const regExp =
    /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|&v(?:i)?=))([^#&?]*).*/;
  const match = url.match(regExp);
  return match?.[1] ? `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg` : null;
}
