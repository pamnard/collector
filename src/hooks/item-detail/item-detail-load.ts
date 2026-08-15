import type { ItemFile } from "@collector/shared";
import { toFormValues } from "../../components/items/item-detail-form";
import type { ItemFormValues } from "../../types/item";
import { getCollectorService } from "../../services/collector-client";
import type { Dispatch, SetStateAction } from "react";

export async function resolveTagNames(loaded: ItemFile): Promise<string[]> {
  if (loaded.tag_ids.length === 0) {
    return [];
  }
  const allTags = await getCollectorService().tags.listTags();
  const byId = new Map(allTags.map((tag) => [tag.id, tag.name]));
  return loaded.tag_ids
    .map((tagId) => byId.get(tagId))
    .filter((name): name is string => typeof name === "string");
}

export type ReloadItemResult = {
  item: ItemFile;
  content: string | null;
};

export async function reloadItemDetail(options: {
  itemId: string;
  setItem: Dispatch<SetStateAction<ItemFile | null>>;
  setContent: Dispatch<SetStateAction<string | null>>;
  setItemTagNames: Dispatch<SetStateAction<string[]>>;
  setFormValues: Dispatch<SetStateAction<ItemFormValues | null>>;
}): Promise<ReloadItemResult> {
  const { item: loadedItem, content: loadedContent } =
    await getCollectorService().items.getItemById(options.itemId);
  const tagNames = await resolveTagNames(loadedItem);
  options.setItem(loadedItem);
  options.setContent(loadedContent);
  options.setItemTagNames(tagNames);
  options.setFormValues(toFormValues(loadedItem, loadedContent, tagNames));
  return { item: loadedItem, content: loadedContent };
}
