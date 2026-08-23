import type { MediaWithPath } from "@collector/core";

export interface PartitionedMediaFiles {
  images: MediaWithPath[];
  others: MediaWithPath[];
  visualFiles: MediaWithPath[];
  listFiles: MediaWithPath[];
}

export function partitionMediaFiles(
  files: MediaWithPath[],
): PartitionedMediaFiles {
  const images: MediaWithPath[] = [];
  const others: MediaWithPath[] = [];
  for (const file of files) {
    if (file.media_type === "image") {
      images.push(file);
    } else {
      others.push(file);
    }
  }
  const visualFiles = [
    ...images,
    ...others.filter((file) => file.media_type === "video"),
  ];
  const listFiles = others.filter((file) => file.media_type !== "video");
  return { images, others, visualFiles, listFiles };
}
