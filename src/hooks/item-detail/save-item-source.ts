import type { ItemFile } from "@collector/shared";
import { getCollectorService } from "../../services/collector-client";
import { errorMessage } from "../../services/runtime-error";
import {
  clearItemDetailSourceBuffers,
  finishItemDetailSave,
} from "./item-detail-after-save";
import { reloadItemDetailAfterSave } from "./item-detail-save-reload";
import type { ItemDetailReloadGate } from "./item-detail-reload-gate";
import type { ItemDetailSaveSink } from "./item-detail-save-types";

export type SaveItemSourceDeps = {
  id: string;
  sourceText: string | null;
  gate: ItemDetailReloadGate;
  sink: ItemDetailSaveSink;
  updateItemSource?: (
    itemId: string,
    rawMarkdown: string,
  ) => Promise<ItemFile>;
  reloadAfterSave?: typeof reloadItemDetailAfterSave;
};

/**
 * Persist raw markdown source, reload detail, clear source buffers, return to view.
 * Surfaces failures via sink.setError (AlertStack). Returns whether save succeeded.
 */
export async function saveItemSource(
  options: SaveItemSourceDeps,
): Promise<boolean> {
  const { id, sourceText, gate, sink } = options;
  if (sourceText === null) {
    return false;
  }

  const updateItemSource =
    options.updateItemSource ??
    ((itemId, raw) =>
      getCollectorService().items.updateItemSource(itemId, raw));
  const reloadAfterSave = options.reloadAfterSave ?? reloadItemDetailAfterSave;

  sink.setIsSaving(true);
  sink.setError(null);

  try {
    const updated = await updateItemSource(id, sourceText);
    await reloadAfterSave({
      itemId: updated.id,
      gate,
      setItem: sink.setItem,
      setContent: sink.setContent,
      setItemTagNames: sink.setItemTagNames,
      setFormValues: sink.setFormValues,
    });
    clearItemDetailSourceBuffers({
      setSourceText: sink.setSourceText,
      setSourceBaseline: sink.setSourceBaseline,
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
