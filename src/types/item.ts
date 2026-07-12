import type { ContentType } from "@collector/shared";

export interface ItemFormValues {
  title: string;
  description: string;
  url: string;
  content_type: ContentType;
  content: string;
  is_favorite: boolean;
  is_archived: boolean;
  tag_ids: string[];
}

export interface CreateItemInput {
  title: string;
  description?: string;
  url?: string | null;
  content_type: ContentType;
  content?: string | null;
}

export interface UpdateItemInput {
  title?: string;
  description?: string;
  url?: string | null;
  content_type?: ContentType;
  content?: string | null;
  is_favorite?: boolean;
  is_archived?: boolean;
  tag_ids?: string[];
}

export const EMPTY_ITEM_FORM: ItemFormValues = {
  title: "",
  description: "",
  url: "",
  content_type: "note",
  content: "",
  is_favorite: false,
  is_archived: false,
  tag_ids: [],
};
