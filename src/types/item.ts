import type { ContentType, SourceType } from "@collector/shared";
import { INBOX_FOLDER_NAME } from "@collector/shared";

export interface ItemFormValues {
  title: string;
  description: string;
  url: string;
  content_type: ContentType;
  content: string;
  /** Tag names (same as document frontmatter). */
  tags: string[];
  folder_path: string;
}

export interface CreateItemInput {
  title: string;
  description?: string;
  url?: string | null;
  content_type: ContentType;
  content?: string | null;
  folder_path?: string;
  source_type?: SourceType;
}

export interface UpdateItemInput {
  title?: string;
  description?: string;
  url?: string | null;
  content_type?: ContentType;
  content?: string | null;
  tags?: string[];
  folder_path?: string;
}

export const EMPTY_ITEM_FORM: ItemFormValues = {
  title: "",
  description: "",
  url: "",
  content_type: "note",
  content: "",
  tags: [],
  folder_path: INBOX_FOLDER_NAME,
};
