import type { MediaWithPath } from "@collector/core";

export interface PartitionedMediaFiles {
  visualFiles: MediaWithPath[];
  listFiles: MediaWithPath[];
}

/** One pass: image|video → visual (encounter order); everything else → list. */
export function partitionMediaFiles(
  files: MediaWithPath[],
): PartitionedMediaFiles {
  const visualFiles: MediaWithPath[] = [];
  const listFiles: MediaWithPath[] = [];
  for (const file of files) {
    if (file.media_type === "image" || file.media_type === "video") {
      visualFiles.push(file);
    } else {
      listFiles.push(file);
    }
  }
  return { visualFiles, listFiles };
}
