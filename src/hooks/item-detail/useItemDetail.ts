import { useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import { useShell } from "../../components/layout/AppLayout";
import type { ItemDetailMode } from "../../components/layout/item-chrome";
import type { ItemFormValues } from "../../types/item";
import { getCollectorService } from "../../services/collector-client";
import { errorMessage } from "../../services/runtime-error";
import { useItemDetailError } from "./useItemDetailError";
import { useItemDetailLoad } from "./useItemDetailLoad";
import { useItemDetailSaves } from "./useItemDetailSaves";
import { reloadItemDetail } from "./item-detail-load";

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
  const { refreshVault, vaultRevision, pruneItem } = useShell();
  const { error, setError } = useItemDetailError();
  const [item, setItem] = useState<ItemFile | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<ItemFormValues | null>(null);
  const [itemTagNames, setItemTagNames] = useState<string[]>([]);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [sourceBaseline, setSourceBaseline] = useState<string | null>(null);
  const [mode, setMode] = useState<ItemDetailMode>("view");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isFormMode = mode === "form";
  const isSourceMode = mode === "source";

  const { reloadGateRef } = useItemDetailLoad({
    id,
    vaultRevision,
    setError,
    setItem,
    setContent,
    setItemTagNames,
    setFormValues,
  });

  const { switchToView, switchToForm, switchToSource } = useItemDetailSaves({
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
  });

  const handleConfirmDelete = async () => {
    if (!id) {
      return;
    }

    setIsDeleting(true);
    setError(null);
    // Before deleteItem: host emits vaultPresentationChanged mid-await.
    reloadGateRef.current.markLeavingAfterDelete();

    try {
      await getCollectorService().items.deleteItem(id);
      pruneItem(id);
      refreshVault();
      navigate("/");
    } catch (err: unknown) {
      reloadGateRef.current.clearLeavingAfterDelete();
      setError(errorMessage(err));
      throw err;
    } finally {
      setIsDeleting(false);
    }
  };

  const handleItemUpdated = () => {
    if (!item) {
      return;
    }

    void reloadItemDetail({
      itemId: item.id,
      setItem,
      setContent,
      setItemTagNames,
      setFormValues,
    }).finally(() => refreshVault());
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
