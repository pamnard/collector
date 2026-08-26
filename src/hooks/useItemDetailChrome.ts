import { useEffect, useRef, useState } from "react";
import type { ExtractCandidate } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import {
  useItemChrome,
  type ItemDetailMode,
} from "../components/layout/item-chrome";
import {
  ITEM_IMPORT_BUSY_ID,
  ITEM_IMPORT_ERROR_ID,
  lintItemFile,
} from "../lib/item-actions";
import { liveCallback } from "../lib/live-callback";
import { useItemImportFlow } from "./useItemImportFlow";

export const ITEM_COPY_ALERT_ID = "item-copy-feedback";

export type UseItemDetailChromeInput = {
  item: ItemFile | null;
  error: string | null;
  mode: ItemDetailMode;
  isSaving: boolean;
  isDeleting: boolean;
  onView: () => void;
  onForm: () => void;
  onSource: () => void;
  onLinted?: () => void;
  onImported?: () => void;
};

export type UseItemDetailChromeResult = {
  deleteConfirmOpen: boolean;
  setDeleteConfirmOpen: (open: boolean) => void;
  renameOpen: boolean;
  setRenameOpen: (open: boolean) => void;
  moveOpen: boolean;
  setMoveOpen: (open: boolean) => void;
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
  importCandidates: ExtractCandidate[];
  importBusy: boolean;
  confirmImport: (candidate: ExtractCandidate) => Promise<void>;
  idCopyFeedback: "copied" | "failed" | null;
  dismissIdCopyFeedback: () => void;
};

export function useItemDetailChrome(
  input: UseItemDetailChromeInput,
): UseItemDetailChromeResult {
  const { publish, clear } = useItemChrome();
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([
    ITEM_COPY_ALERT_ID,
    ITEM_IMPORT_BUSY_ID,
    ITEM_IMPORT_ERROR_ID,
  ]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
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
    onLinted,
    onImported,
  } = input;

  // Header chrome republishes only when status fields change — not on every
  // parent render. Mode/import handlers stay live via refs so leave-to-view
  // and menu peek still see current callbacks without unstable effect deps.
  const onViewRef = useRef(onView);
  const onFormRef = useRef(onForm);
  const onSourceRef = useRef(onSource);
  const onLintedRef = useRef(onLinted);
  const onImportedRef = useRef(onImported);
  onViewRef.current = onView;
  onFormRef.current = onForm;
  onSourceRef.current = onSource;
  onLintedRef.current = onLinted;
  onImportedRef.current = onImported;
  const onViewLive = useRef(liveCallback(() => onViewRef.current)).current;
  const onFormLive = useRef(liveCallback(() => onFormRef.current)).current;
  const onSourceLive = useRef(liveCallback(() => onSourceRef.current)).current;

  const {
    importOpen,
    setImportOpen,
    importCandidates,
    importAvailable,
    importBusy,
    refreshImportAvailability,
    handleImport,
    runImport,
  } = useItemImportFlow({
    itemId: item?.id,
    alerts,
    onDone: () => onImportedRef.current?.(),
  });

  const handleImportRef = useRef(handleImport);
  const refreshImportAvailabilityRef = useRef(refreshImportAvailability);
  handleImportRef.current = handleImport;
  refreshImportAvailabilityRef.current = refreshImportAvailability;

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

  const dismissIdCopyFeedback = () => {
    if (idCopyFeedbackTimer.current !== null) {
      window.clearTimeout(idCopyFeedbackTimer.current);
    }
    idCopyFeedbackTimer.current = null;
    setIdCopyFeedback(null);
    alerts.dismiss(ITEM_COPY_ALERT_ID);
  };

  const showIdCopyFeedback = (next: "copied" | "failed") => {
    if (idCopyFeedbackTimer.current !== null) {
      window.clearTimeout(idCopyFeedbackTimer.current);
    }
    setIdCopyFeedback(next);
    alerts.upsert(ITEM_COPY_ALERT_ID, {
      tone: next === "failed" ? "danger" : "info",
      message:
        next === "failed" ? "Не удалось скопировать id" : "Id скопирован",
      onDismiss: dismissIdCopyFeedback,
    });
    idCopyFeedbackTimer.current = window.setTimeout(() => {
      setIdCopyFeedback(null);
      alerts.dismiss(ITEM_COPY_ALERT_ID);
      idCopyFeedbackTimer.current = null;
    }, 2000);
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

  const handleLint = async () => {
    if (!item) {
      return;
    }
    const updated = await lintItemFile(alerts, item.id);
    if (updated === undefined) {
      return;
    }
    onLintedRef.current?.();
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
      importAvailable,
      onCopyId: () => {
        void handleCopyItemId();
      },
      onView: onViewLive,
      onForm: onFormLive,
      onSource: onSourceLive,
      onMove: () => {
        setMoveOpen(true);
      },
      onRename: () => {
        setRenameOpen(true);
      },
      onImport: () => {
        void handleImportRef.current();
      },
      onLint: () => {
        void handleLint();
      },
      onDelete: () => {
        setDeleteConfirmOpen(true);
      },
      onActionsMenuOpenChange: (open) => {
        if (open) {
          void refreshImportAvailabilityRef.current();
        }
      },
    });
  }, [
    item,
    error,
    mode,
    idCopyFeedback,
    isSaving,
    isDeleting,
    importAvailable,
    publish,
    onViewLive,
    onFormLive,
    onSourceLive,
  ]);

  return {
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    renameOpen,
    setRenameOpen,
    moveOpen,
    setMoveOpen,
    importOpen,
    setImportOpen,
    importCandidates,
    importBusy,
    confirmImport: runImport,
    idCopyFeedback,
    dismissIdCopyFeedback,
  };
}
