import { useEffect, useRef, useState } from "react";
import type { ItemFile } from "@collector/shared";
import {
  useItemChrome,
  type ItemDetailMode,
} from "../components/layout/item-chrome";

export type UseItemDetailChromeInput = {
  item: ItemFile | null;
  error: string | null;
  mode: ItemDetailMode;
  isSaving: boolean;
  isDeleting: boolean;
  onView: () => void;
  onForm: () => void;
  onSource: () => void;
};

export type UseItemDetailChromeResult = {
  deleteConfirmOpen: boolean;
  setDeleteConfirmOpen: (open: boolean) => void;
  idCopyFeedback: "copied" | "failed" | null;
  dismissIdCopyFeedback: () => void;
};

export function useItemDetailChrome(
  input: UseItemDetailChromeInput,
): UseItemDetailChromeResult {
  const { publish, clear } = useItemChrome();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [idCopyFeedback, setIdCopyFeedback] = useState<
    "copied" | "failed" | null
  >(null);
  const idCopyFeedbackTimer = useRef<number | null>(null);
  const {
    item,
    error,
    mode,
    isSaving,
    isDeleting,
    onView,
    onForm,
    onSource,
  } = input;

  useEffect(() => {
    return () => {
      clear();
    };
  }, [clear]);

  useEffect(() => {
    return () => {
      if (idCopyFeedbackTimer.current !== null) {
        window.clearTimeout(idCopyFeedbackTimer.current);
      }
    };
  }, []);

  const showIdCopyFeedback = (next: "copied" | "failed") => {
    if (idCopyFeedbackTimer.current !== null) {
      window.clearTimeout(idCopyFeedbackTimer.current);
    }
    setIdCopyFeedback(next);
    idCopyFeedbackTimer.current = window.setTimeout(() => {
      setIdCopyFeedback(null);
      idCopyFeedbackTimer.current = null;
    }, 2000);
  };

  const dismissIdCopyFeedback = () => {
    if (idCopyFeedbackTimer.current !== null) {
      window.clearTimeout(idCopyFeedbackTimer.current);
      idCopyFeedbackTimer.current = null;
    }
    setIdCopyFeedback(null);
  };

  const handleCopyItemId = async () => {
    if (!item) {
      return;
    }

    try {
      await navigator.clipboard.writeText(item.id);
      showIdCopyFeedback("copied");
    } catch (err: unknown) {
      console.error("Item id copy failed", { error: err, itemId: item.id });
      showIdCopyFeedback("failed");
    }
  };

  useEffect(() => {
    const status = item ? "ready" : error ? "error" : "loading";
    publish({
      status,
      item: item
        ? {
            id: item.id,
            title: item.title,
            folder_path: item.folder_path,
          }
        : null,
      mode,
      idCopyFeedback,
      isSaving,
      isDeleting,
      onCopyId: () => {
        void handleCopyItemId();
      },
      onView,
      onForm,
      onSource,
      onDelete: () => {
        setDeleteConfirmOpen(true);
      },
    });
  }, [
    item,
    error,
    mode,
    idCopyFeedback,
    isSaving,
    isDeleting,
    publish,
  ]);

  return {
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    idCopyFeedback,
    dismissIdCopyFeedback,
  };
}
