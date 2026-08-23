import type { ItemFile } from "@collector/shared";
import type { ItemFormValues, UpdateItemInput } from "../../types/item";
import { getCollectorService } from "../../services/collector-client";
import { errorMessage } from "../../services/runtime-error";
import { finishItemDetailSave } from "./item-detail-after-save";
import { reloadItemDetailAfterSave } from "./item-detail-save-reload";
import type { ItemDetailReloadGate } from "./item-detail-reload-gate";
import type { ItemDetailSaveSink } from "./item-detail-save-types";

export type SaveItemMetadataDeps = {
  id: string;
  formValues: ItemFormValues;
  gate: ItemDetailReloadGate;
  sink: ItemDetailSaveSink;
  updateItem?: (
    itemId: string,
    input: UpdateItemInput,
  ) => Promise<ItemFile>;
  reloadAfterSave?: typeof reloadItemDetailAfterSave;
};

/**
 * Persist form metadata, reload detail from disk, then return to view.
 * Surfaces failures via sink.setError (AlertStack). Returns whether save succeeded.
 */
export async function saveItemMetadata(
  options: SaveItemMetadataDeps,
): Promise<boolean> {
  const { id, formValues, gate, sink } = options;
  if (!formValues.title.trim()) {
    sink.setError("Название обязательно");
    return false;
  }

  const updateItem =
    options.updateItem ??
    ((itemId, input) => getCollectorService().items.updateItem(itemId, input));
  const reloadAfterSave = options.reloadAfterSave ?? reloadItemDetailAfterSave;

  sink.setIsSaving(true);
  sink.setError(null);

  try {
    const updated = await updateItem(id, {
      title: formValues.title.trim(),
      description: formValues.description.trim(),
      url: formValues.url.trim() || null,
      content_type: formValues.content_type,
      content: formValues.content.trim() || null,
      tags: formValues.tags,
      folder_path: formValues.folder_path,
      properties: formValues.properties,
    });
    // Reload from disk so UI matches autofixed markdown (same as source-save).
    // Does not await derived index/localize — soft reload on itemDerivedComplete (#769).
    await reloadAfterSave({
      itemId: updated.id,
      gate,
      setItem: sink.setItem,
      setContent: sink.setContent,
      setItemTagNames: sink.setItemTagNames,
      setFormValues: sink.setFormValues,
    });
    finishItemDetailSave({
      previousId: id,
      savedId: updated.id,
      setMode: sink.setMode,
      navigate: sink.navigate,
    });
    return true;
  } catch (err: unknown) {
    sink.setError(errorMessage(err));
    return false;
  } finally {
    sink.setIsSaving(false);
  }
}
