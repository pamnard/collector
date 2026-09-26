import { useEffect, useMemo, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../alerts/AlertBusProvider";
import { errorMessage } from "../alerts/alert-store";
import {
  isCurrentItemFolderDestination,
  listItemFolderDestinations,
} from "../../lib/folder-actions";
import { getCollectorService } from "../../services/collector-client";
import {
  FolderDestinationDialog,
  type FolderSuggestionRow,
} from "./FolderDestinationDialog";

export const ITEM_FOLDER_SUGGEST_ERROR_ID = "item-folder-suggest-error";

export interface MoveItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  itemLabel: string;
  currentFolderPath: string;
  tree: FolderTreeNode[];
  onConfirm: (folderPath: string) => void;
}

export function MoveItemDialog({
  open,
  onOpenChange,
  itemId,
  itemLabel,
  currentFolderPath,
  tree,
  onConfirm,
}: MoveItemDialogProps) {
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([ITEM_FOLDER_SUGGEST_ERROR_ID]);
  const [suggestions, setSuggestions] = useState<FolderSuggestionRow[]>([]);

  const destinations = useMemo(
    () =>
      listItemFolderDestinations(tree).map((row) => ({
        path: row.path,
        label: row.label,
        disabled: isCurrentItemFolderDestination(currentFolderPath, row.path),
      })),
    [currentFolderPath, tree],
  );

  useEffect(() => {
    if (!open) {
      setSuggestions([]);
      alerts.dismiss(ITEM_FOLDER_SUGGEST_ERROR_ID);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const hits = await getCollectorService().items.suggestItemFolderMoves(
          itemId,
          3,
        );
        if (cancelled) {
          return;
        }
        alerts.dismiss(ITEM_FOLDER_SUGGEST_ERROR_ID);
        setSuggestions(
          hits.map((hit) => ({
            path: hit.path,
            label: hit.path,
          })),
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSuggestions([]);
        alerts.upsert(ITEM_FOLDER_SUGGEST_ERROR_ID, {
          tone: "danger",
          message: "Не удалось подобрать папки",
          detail: errorMessage(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [alerts, itemId, open]);

  return (
    <FolderDestinationDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Переместить файл"
      description={
        <>
          Выберите папку для{" "}
          <span className="break-all font-medium text-foreground">
            {itemLabel}
          </span>
          .
        </>
      }
      destinations={destinations}
      suggestions={suggestions}
      listAriaLabel="Папка назначения"
      onConfirm={onConfirm}
    />
  );
}
