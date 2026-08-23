import type { MutableRefObject } from "react";
import {
  switchItemDetailToForm,
  switchItemDetailToSource,
  switchItemDetailToView,
} from "./item-detail-mode-transitions";
import type { ItemDetailReloadGate } from "./item-detail-reload-gate";
import type {
  ItemDetailSaveSink,
  ItemDetailSaveSnapshot,
} from "./item-detail-save-types";
import { saveItemMetadata } from "./save-item-metadata";
import { saveItemSource } from "./save-item-source";

export type UseItemDetailSavesOptions = {
  snapshot: ItemDetailSaveSnapshot;
  sink: ItemDetailSaveSink;
  reloadGateRef: MutableRefObject<ItemDetailReloadGate>;
};

export function useItemDetailSaves(options: UseItemDetailSavesOptions) {
  const { snapshot, sink, reloadGateRef } = options;

  const handleSave = async (): Promise<boolean> => {
    if (!snapshot.id || !snapshot.formValues) {
      return false;
    }
    return saveItemMetadata({
      id: snapshot.id,
      formValues: snapshot.formValues,
      gate: reloadGateRef.current,
      sink,
    });
  };

  const handleSourceSave = async (): Promise<boolean> => {
    if (!snapshot.id) {
      return false;
    }
    return saveItemSource({
      id: snapshot.id,
      sourceText: snapshot.sourceText,
      gate: reloadGateRef.current,
      sink,
    });
  };

  const switchToView = () => {
    switchItemDetailToView({
      snapshot,
      sink,
      saveMetadata: handleSave,
      saveSource: handleSourceSave,
    });
  };

  const switchToForm = () => {
    switchItemDetailToForm({
      snapshot,
      sink,
      saveSource: handleSourceSave,
    });
  };

  const switchToSource = () => {
    switchItemDetailToSource({
      snapshot,
      sink,
      saveMetadata: handleSave,
    });
  };

  return {
    switchToView,
    switchToForm,
    switchToSource,
  };
}
