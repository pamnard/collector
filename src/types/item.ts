import type { ContentType, SourceType } from "@collector/shared";
import { INBOX_FOLDER_NAME } from "@collector/shared";

export interface ItemFormValues {
  title: string;
  description: string;
  url: string;
  content_type: ContentType;
  content: string;
  tag_ids: string[];
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
  tag_ids?: string[];
  folder_path?: string;
}

export const EMPTY_ITEM_FORM: ItemFormValues = {
  title: "",
  description: "",
  url: "",
  content_type: "note",
  content: "",
  tag_ids: [],
  folder_path: INBOX_FOLDER_NAME,
};
