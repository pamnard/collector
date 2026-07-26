export function folderPathSegments(
  folderPath: string,
): Array<{ name: string; path: string }> {
  const parts = folderPath.split("/").filter(Boolean);
  const segments: Array<{ name: string; path: string }> = [];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    segments.push({ name: part, path: acc });
  }
  return segments;
}
