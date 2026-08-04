import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import { useShell } from "../components/layout/AppLayout";
import type { ItemDetailMode } from "../components/layout/item-chrome";
import {
  isFormDirty,
  toFormValues,
} from "../components/items/item-detail-form";
import type { ItemFormValues } from "../types/item";
import { getCollectorService } from "../services/collector-client";
import { errorMessage } from "../services/runtime-error";

export const ITEM_DETAIL_ERROR_ID = "item-detail-error";

export type UseItemDetailResult = {
  id: string | undefined;
  item: ItemFile | null;
  content: string | null;
  formValues: ItemFormValues | null;
  setFormValues: Dispatch<SetStateAction<ItemFormValues | null>>;
  itemTagNames: string[];
  sourceText: string | null;
  setSourceText: Dispatch<SetStateAction<string | null>>;
  mode: ItemDetailMode;
  isFormMode: boolean;
  isSourceMode: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  error: string | null;
  switchToView: () => void;
  switchToForm: () => void;
  switchToSource: () => void;
  handleConfirmDelete: () => Promise<void>;
  handleItemUpdated: () => void;
};

export function useItemDetail(): UseItemDetailResult {
  const params = useParams();
  const id = params["*"];
  const navigate = useNavigate();
  const { refreshVault } = useShell();
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([ITEM_DETAIL_ERROR_ID]);
  const [item, setItem] = useState<ItemFile | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<ItemFormValues | null>(null);
  const [itemTagNames, setItemTagNames] = useState<string[]>([]);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [sourceBaseline, setSourceBaseline] = useState<string | null>(null);
  const [mode, setMode] = useState<ItemDetailMode>("view");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);

  const setError = useCallback(
    (message: string | null) => {
      setErrorState(message);
      if (message) {
        alerts.upsert(ITEM_DETAIL_ERROR_ID, {
          tone: "danger",
          message,
        });
      } else {
        alerts.dismiss(ITEM_DETAIL_ERROR_ID);
      }
    },
    [alerts],
  );

  const isFormMode = mode === "form";
  const isSourceMode = mode === "source";
  const isSourceDirty =
    sourceText !== null &&
    sourceBaseline !== null &&
    sourceText !== sourceBaseline;

  const resolveTagNames = async (loaded: ItemFile): Promise<string[]> => {
    if (loaded.tag_ids.length === 0) {
      return [];
    }
    const allTags = await getCollectorService().tags.listTags();
    const byId = new Map(allTags.map((tag) => [tag.id, tag.name]));
    return loaded.tag_ids
      .map((tagId) => byId.get(tagId))
      .filter((name): name is string => typeof name === "string");
  };

  const reloadItem = async (itemId: string) => {
    const { item: loadedItem, content: loadedContent } =
      await getCollectorService().items.getItemById(itemId);
    const tagNames = await resolveTagNames(loadedItem);
    setItem(loadedItem);
    setContent(loadedContent);
    setItemTagNames(tagNames);
    setFormValues(toFormValues(loadedItem, loadedContent, tagNames));
    return { item: loadedItem, content: loadedContent };
  };

  useEffect(() => {
    if (!id) {
      setError("Item id is missing");
      return;
    }

    setItem(null);
    setError(null);

    reloadItem(id).catch((err: unknown) => {
      setError(errorMessage(err));
    });
  }, [id, setError]);

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
      await reloadItem(updated.id);
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

  const handleConfirmDelete = async () => {
    if (!id) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await getCollectorService().items.deleteItem(id);
      refreshVault();
      navigate("/");
    } catch (err: unknown) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setIsDeleting(false);
    }
  };

  const clearSource = () => {
    setSourceText(null);
    setSourceBaseline(null);
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

  const handleItemUpdated = () => {
    if (!item) {
      return;
    }

    void reloadItem(item.id).finally(() => refreshVault());
  };

  return {
    id,
    item,
    content,
    formValues,
    setFormValues,
    itemTagNames,
    sourceText,
    setSourceText,
    mode,
    isFormMode,
    isSourceMode,
    isSaving,
    isDeleting,
    error,
    switchToView,
    switchToForm,
    switchToSource,
    handleConfirmDelete,
    handleItemUpdated,
  };
}
