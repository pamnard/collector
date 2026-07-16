import type { IndexSyncProgress } from "../adapters/types.js";

export type IndexBannerStatus = "idle" | "rebuilding" | "running" | "done";

export interface IndexBannerInput {
  status: IndexBannerStatus;
  progress: IndexSyncProgress | null;
}

/** Label for the indexing / rebuild status alert. */
export function formatIndexingBannerLabel(input: IndexBannerInput): string {
  if (input.status === "rebuilding") {
    return "Пересборка индекса…";
  }

  const progress = input.progress;
  if (!progress || progress.total <= 0) {
    return "Индексация хранилища…";
  }
  if (progress.phase === "content") {
    return `Индексация поиска… ${progress.processed}/${progress.total}`;
  }
  return `Индексация… ${progress.processed}/${progress.total}`;
}
