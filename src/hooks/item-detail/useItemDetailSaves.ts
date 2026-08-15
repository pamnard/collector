import {
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { NavigateFunction } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import {
  isFormDirty,
  toFormValues,
} from "../../components/items/item-detail-form";
import type { ItemFormValues } from "../../types/item";
import type { ItemDetailMode } from "../../components/layout/item-chrome";
import { getCollectorService } from "../../services/collector-client";
import { errorMessage } from "../../services/runtime-error";
import { reloadItemDetail, resolveTagNames } from "./item-detail-load";

export function useItemDetailSaves(options: {
  id: string | undefined;
  item: ItemFile | null;
  content: string | null;
  formValues: ItemFormValues | null;
  itemTagNames: string[];
  sourceText: string | null;
  sourceBaseline: string | null;
  mode: ItemDetailMode;
  isSaving: boolean;
  setFormValues: Dispatch<SetStateAction<ItemFormValues | null>>;
  setItem: Dispatch<SetStateAction<ItemFile | null>>;
  setContent: Dispatch<SetStateAction<string | null>>;
  setItemTagNames: Dispatch<SetStateAction<string[]>>;
  setSourceText: Dispatch<SetStateAction<string | null>>;
  setSourceBaseline: Dispatch<SetStateAction<string | null>>;
  setMode: Dispatch<SetStateAction<ItemDetailMode>>;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
  setError: (message: string | null) => void;
  refreshVault: () => void;
  navigate: NavigateFunction;
}) {
  const {
    id,
    item,
    content,
    formValues,
    itemTagNames,
    sourceText,
    sourceBaseline,
    mode,
    isSaving,
    setFormValues,
    setItem,
    setContent,
    setItemTagNames,
    setSourceText,
    setSourceBaseline,
    setMode,
    setIsSaving,
    setError,
    refreshVault,
    navigate,
  } = options;

  const isSourceDirty =
    sourceText !== null &&
    sourceBaseline !== null &&
    sourceText !== sourceBaseline;

  const clearSource = useCallback(() => {
    setSourceText(null);
    setSourceBaseline(null);
  }, [setSourceText, setSourceBaseline]);

  const handleSave = async (): Promise<boolean> => {
    if (!id || !formValues) {
      return false;
    }
    if (!formValues.title.trim()) {
      setError("Название обязательно");
      return false;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updated = await getCollectorService().items.updateItem(id, {
        title: formValues.title.trim(),
        description: formValues.description.trim(),
        url: formValues.url.trim() || null,
        content_type: formValues.content_type,
        content: formValues.content.trim() || null,
        tags: formValues.tags,
        folder_path: formValues.folder_path,
        properties: formValues.properties,
      });
      const updatedContent = formValues.content.trim() || null;
      const tagNames = await resolveTagNames(updated);
      setItem(updated);
      setContent(updatedContent);
      setItemTagNames(tagNames);
      setFormValues(toFormValues(updated, updatedContent, tagNames));
      setMode("view");
      refreshVault();
      if (updated.id !== id) {
        navigate(`/item/${updated.id}`, { replace: true });
      }
      return true;
    } catch (err: unknown) {
      setError(errorMessage(err));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSourceSave = async (): Promise<boolean> => {
    if (!id || sourceText === null) {
      return false;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updated = await getCollectorService().items.updateItemSource(
        id,
        sourceText,
      );
      await reloadItemDetail({
        itemId: updated.id,
        setItem,
        setContent,
        setItemTagNames,
        setFormValues,
      });
      setSourceText(null);
      setSourceBaseline(null);
      setMode("view");
      refreshVault();
      if (updated.id !== id) {
        navigate(`/item/${updated.id}`, { replace: true });
      }
      return true;
    } catch (err: unknown) {
      setError(errorMessage(err));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const switchToView = () => {
    if (mode === "view" || isSaving) {
      return;
    }
    if (mode === "source") {
      if (!isSourceDirty) {
        clearSource();
        setMode("view");
        setError(null);
        return;
      }
      void handleSourceSave();
      return;
    }
    if (!formValues || !item) {
      setMode("view");
      return;
    }
    if (!isFormDirty(formValues, item, content, itemTagNames)) {
      setMode("view");
      setError(null);
      return;
    }
    void handleSave();
  };

  const switchToForm = () => {
    if (isSaving) {
      return;
    }

    const enter = async () => {
      if (mode === "source" && isSourceDirty) {
        const saved = await handleSourceSave();
        if (!saved) {
          return;
        }
      } else if (mode === "source") {
        clearSource();
      }
      setMode("form");
      setError(null);
    };

    void enter();
  };

  const switchToSource = () => {
    if (!id || isSaving) {
      return;
    }

    const enter = async () => {
      if (
        mode === "form" &&
        formValues &&
        item &&
        isFormDirty(formValues, item, content, itemTagNames)
      ) {
        const saved = await handleSave();
        if (!saved) {
          return;
        }
      }

      setIsSaving(true);
      setError(null);
      try {
        const raw = await getCollectorService().items.getItemSource(id);
        setSourceText(raw);
        setSourceBaseline(raw);
        setMode("source");
      } catch (err: unknown) {
        setError(errorMessage(err));
      } finally {
        setIsSaving(false);
      }
    };

    void enter();
  };

  return {
    switchToView,
    switchToForm,
    switchToSource,
  };
}
