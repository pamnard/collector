export type ItemSyncAction = "skip" | "patch" | "reindex";

export interface ItemSyncClassificationInput {
  indexed: boolean;
  dbMtimeMs: number | null;
  diskMtimeMs: number;
  dbUpdatedAt?: string;
  dbContentRevision?: number;
  dbCreatedAt?: string;
  diskUpdatedAt: string;
  diskContentRevision: number;
  diskCreatedAt: string;
}

export function classifyItemSyncAction(input: ItemSyncClassificationInput): ItemSyncAction {
  if (!input.indexed) {
    return "reindex";
  }

  const metadataMatches =
    input.dbUpdatedAt === input.diskUpdatedAt &&
    input.dbContentRevision === input.diskContentRevision;
  const createdAtMatches = input.dbCreatedAt === input.diskCreatedAt;

  if (input.dbMtimeMs !== null && input.dbMtimeMs === input.diskMtimeMs) {
    if (metadataMatches && createdAtMatches) {
      return "skip";
    }
    if (metadataMatches) {
      // mtime + list metadata match, but created_at drifted — cheap patch.
      return "patch";
    }
    return "reindex";
  }

  if (metadataMatches) {
    return "patch";
  }

  return "reindex";
}
