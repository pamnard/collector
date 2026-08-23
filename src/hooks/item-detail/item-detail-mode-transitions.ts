import { isFormDirty as defaultIsFormDirty } from "../../components/items/item-detail-form";
import { getCollectorService } from "../../services/collector-client";
import { errorMessage } from "../../services/runtime-error";
import { clearItemDetailSourceBuffers } from "./item-detail-after-save";
import type {
  ItemDetailSaveSink,
  ItemDetailSaveSnapshot,
} from "./item-detail-save-types";

export function isItemDetailSourceDirty(
  sourceText: string | null,
  sourceBaseline: string | null,
): boolean {
  return (
    sourceText !== null &&
    sourceBaseline !== null &&
    sourceText !== sourceBaseline
  );
}

type FormDirtyFn = typeof defaultIsFormDirty;

export function switchItemDetailToView(options: {
  snapshot: ItemDetailSaveSnapshot;
  sink: ItemDetailSaveSink;
  saveMetadata: () => Promise<boolean>;
  saveSource: () => Promise<boolean>;
  isFormDirty?: FormDirtyFn;
}): void {
  const { snapshot, sink, saveMetadata, saveSource } = options;
  const isFormDirty = options.isFormDirty ?? defaultIsFormDirty;
  const { mode, isSaving, formValues, item, content, itemTagNames } = snapshot;

  if (mode === "view" || isSaving) {
    return;
  }

  if (mode === "source") {
    if (
      !isItemDetailSourceDirty(snapshot.sourceText, snapshot.sourceBaseline)
    ) {
      clearItemDetailSourceBuffers({
        setSourceText: sink.setSourceText,
        setSourceBaseline: sink.setSourceBaseline,
      });
      sink.setMode("view");
      sink.setError(null);
      return;
    }
    void saveSource();
    return;
  }

  if (!formValues || !item) {
    sink.setMode("view");
    return;
  }
  if (!isFormDirty(formValues, item, content, itemTagNames)) {
    sink.setMode("view");
    sink.setError(null);
    return;
  }
  void saveMetadata();
}

export function switchItemDetailToForm(options: {
  snapshot: ItemDetailSaveSnapshot;
  sink: ItemDetailSaveSink;
  saveSource: () => Promise<boolean>;
}): void {
  const { snapshot, sink, saveSource } = options;
  if (snapshot.isSaving) {
    return;
  }

  const enter = async () => {
    if (
      snapshot.mode === "source" &&
      isItemDetailSourceDirty(snapshot.sourceText, snapshot.sourceBaseline)
    ) {
      const saved = await saveSource();
      if (!saved) {
        return;
      }
    } else if (snapshot.mode === "source") {
      clearItemDetailSourceBuffers({
        setSourceText: sink.setSourceText,
        setSourceBaseline: sink.setSourceBaseline,
      });
    }
    sink.setMode("form");
    sink.setError(null);
  };

  void enter();
}

export function switchItemDetailToSource(options: {
  snapshot: ItemDetailSaveSnapshot;
  sink: ItemDetailSaveSink;
  saveMetadata: () => Promise<boolean>;
  getItemSource?: (itemId: string) => Promise<string>;
  isFormDirty?: FormDirtyFn;
}): void {
  const { snapshot, sink, saveMetadata } = options;
  const isFormDirty = options.isFormDirty ?? defaultIsFormDirty;
  const getItemSource =
    options.getItemSource ??
    ((itemId: string) => getCollectorService().items.getItemSource(itemId));

  const itemId = snapshot.id;
  if (!itemId || snapshot.isSaving) {
    return;
  }

  const enter = async () => {
    const { mode, formValues, item, content, itemTagNames } = snapshot;
    if (
      mode === "form" &&
      formValues &&
      item &&
      isFormDirty(formValues, item, content, itemTagNames)
    ) {
      const saved = await saveMetadata();
      if (!saved) {
        return;
      }
    }

    sink.setIsSaving(true);
    sink.setError(null);
    try {
      const raw = await getItemSource(itemId);
      sink.setSourceText(raw);
      sink.setSourceBaseline(raw);
      sink.setMode("source");
    } catch (err: unknown) {
      sink.setError(errorMessage(err));
    } finally {
      sink.setIsSaving(false);
    }
  };

  void enter();
}
