export type ItemSyncAction = "skip" | "patch" | "reindex";

export interface ItemSyncClassificationInput {
  indexed: boolean;
  dbMtimeMs: number | null;
  diskMtimeMs: number;
  dbUpdatedAt?: string;
  dbContentRevision?: number;
  diskUpdatedAt: string;
  diskContentRevision: number;
}

export function classifyItemSyncAction(input: ItemSyncClassificationInput): ItemSyncAction {
  if (!input.indexed) {
    return "reindex";
  }

  if (input.dbMtimeMs !== null && input.dbMtimeMs === input.diskMtimeMs) {
    if (
      input.dbUpdatedAt === input.diskUpdatedAt &&
      input.dbContentRevision === input.diskContentRevision
    ) {
      return "skip";
    }
    return "reindex";
  }

  if (
    input.dbUpdatedAt === input.diskUpdatedAt &&
    input.dbContentRevision === input.diskContentRevision
  ) {
    return "patch";
  }

  return "reindex";
}
