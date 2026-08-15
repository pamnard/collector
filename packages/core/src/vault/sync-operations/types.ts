import type { ItemFile } from "@collector/shared";

export interface ReindexWork {
  itemId: string;
  diskMtimeMs: number;
  item?: ItemFile;
  content?: string | null;
  hasContentFile?: boolean;
}
