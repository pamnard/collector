import { ChevronDown, ChevronRight, Folder, FolderOpen, Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { isInboxFolderName } from "@collector/shared";
import { Badge } from "@/components/ui/badge";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../alerts/AlertBusProvider";
import { IndexingStatusMessage } from "../alerts/IndexingStatusMessage";
import { errorMessage } from "../alerts/alert-store";
import { useFolderTree } from "../../hooks/useFolderTree";
import type { FolderActionId } from "../../lib/folder-action-catalog";
import {
  buildChildFolderPath,
  folderLeafName,
  moveFolderTo,
  renameFolderLeaf,
  rewriteFolderNavFilterAfterMove,
} from "../../lib/folder-actions";
import { getCollectorService } from "../../services/collector-client";
import type { NavFilter } from "../../types/ui";
import { navFilterKey } from "../../types/ui";
import { CreateChildFolderDialog } from "../folders/CreateChildFolderDialog";
import { FolderContextMenu } from "../folders/FolderContextMenu";
import { MoveFolderDialog } from "../folders/MoveFolderDialog";
import { RenameFolderDialog } from "../folders/RenameFolderDialog";
import { useShell } from "./AppLayout";

const FOLDER_MOVE_BUSY_ID = "folder-move-busy";
const FOLDER_MOVE_ERROR_ID = "folder-move-error";
const FOLDER_RENAME_BUSY_ID = "folder-rename-busy";
const FOLDER_RENAME_ERROR_ID = "folder-rename-error";
const FOLDER_CREATE_BUSY_ID = "folder-create-busy";
const FOLDER_CREATE_ERROR_ID = "folder-create-error";

const NEST_LIST_CLASS =
  "ml-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border pl-2.5 py-0.5";

function collectionRowClass(selected: boolean): string {
  return `flex w-full items-center gap-0.5 rounded-md px-2 text-sm transition-colors ${
    selected
      ? "bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-400"
      : "text-neutral-900 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700"
  }`;
}

function CollectionFolderRow({
  node,
  activeKey,
  isSettings,
  onSelect,
  onAction,
}: {
  node: FolderTreeNode;
  activeKey: string;
  isSettings: boolean;
  onSelect: (filter: NavFilter) => void;
  onAction: (id: FolderActionId, folderPath: string) => void;
}) {
  const isAncestorOfActive = activeKey.startsWith(`folder:${node.path}/`);
  const [open, setOpen] = useState(isAncestorOfActive);

  useEffect(() => {
    if (isAncestorOfActive) {
      setOpen(true);
    }
  }, [isAncestorOfActive]);

  const filter: NavFilter = { type: "folder", folderPath: node.path };
  const selected = !isSettings && activeKey === navFilterKey(filter);
  const inbox = isInboxFolderName(node.name);
  const Icon = inbox ? Inbox : selected ? FolderOpen : Folder;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <FolderContextMenu folderPath={node.path} onAction={onAction}>
        <div className={collectionRowClass(selected)}>
          <button
            type="button"
            onClick={() => onSelect(filter)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left"
          >
            <Icon size={18} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            <Badge
              variant="secondary"
              className="h-5 min-w-5 shrink-0 border-transparent bg-black/10 px-1.5 text-xs tabular-nums text-neutral-500 hover:bg-black/10 dark:bg-white/10 dark:text-neutral-400 dark:hover:bg-white/10"
            >
              {node.item_count}
            </Badge>
          </button>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-100"
              aria-expanded={open}
              aria-label={open ? "Свернуть" : "Развернуть"}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="size-6 shrink-0" aria-hidden />
          )}
        </div>
      </FolderContextMenu>
      {open && hasChildren ? (
        <div className={NEST_LIST_CLASS}>
          {node.children.map((child) => (
            <CollectionFolderRow
              key={child.path}
              node={child}
              activeKey={activeKey}
              isSettings={isSettings}
              onSelect={onSelect}
              onAction={onAction}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface SidebarCollectionsProps {
  activeFilter: NavFilter;
  isSettings: boolean;
  onSelect: (filter: NavFilter) => void;
  vaultRevision: number;
  refreshVault: () => void;
}

export function SidebarCollections({
  activeFilter,
  isSettings,
  onSelect,
  vaultRevision,
  refreshVault,
}: SidebarCollectionsProps) {
  const { openCreate } = useShell();
  const folders = useFolderTree(vaultRevision);
  const activeKey = navFilterKey(activeFilter);
  const alerts = useAlerts();
  const [moveSourcePath, setMoveSourcePath] = useState<string | null>(null);
  const [renameSourcePath, setRenameSourcePath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const [createLeafValue, setCreateLeafValue] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  useDismissAlertsOnUnmount([
    FOLDER_MOVE_BUSY_ID,
    FOLDER_MOVE_ERROR_ID,
    FOLDER_RENAME_BUSY_ID,
    FOLDER_RENAME_ERROR_ID,
    FOLDER_CREATE_BUSY_ID,
    FOLDER_CREATE_ERROR_ID,
  ]);

  const handleRequestRename = (folderPath: string) => {
    setRenameSourcePath(folderPath);
    setRenameValue(folderLeafName(folderPath));
  };

  const handleRequestCreateChild = (folderPath: string) => {
    setCreateParentPath(folderPath);
    setCreateLeafValue("");
  };

  const handleFolderAction = (id: FolderActionId, path: string) => {
    if (id === "new-note") {
      openCreate(path);
      return;
    }
    if (id === "new-folder") {
      handleRequestCreateChild(path);
      return;
    }
    if (id === "rename") {
      handleRequestRename(path);
      return;
    }
    if (id === "move") {
      setMoveSourcePath(path);
    }
  };

  const handleConfirmMove = async (
    folderPath: string,
    newParentPath: string,
  ) => {
    alerts.dismiss(FOLDER_MOVE_ERROR_ID);
    alerts.upsert(FOLDER_MOVE_BUSY_ID, {
      tone: "warning",
      dismissible: false,
      message: (
        <IndexingStatusMessage label="Перемещаю папку и всё содержимое…" />
      ),
    });
    try {
      const newPath = await moveFolderTo(folderPath, newParentPath);
      alerts.dismiss(FOLDER_MOVE_BUSY_ID);
      refreshVault();
      const next = rewriteFolderNavFilterAfterMove(
        activeFilter,
        folderPath,
        newPath,
      );
      if (next) {
        onSelect(next);
      }
    } catch (error) {
      alerts.dismiss(FOLDER_MOVE_BUSY_ID);
      alerts.upsert(FOLDER_MOVE_ERROR_ID, {
        tone: "danger",
        message: errorMessage(error),
      });
    }
  };

  const handleConfirmRename = async (folderPath: string, newLeafName: string) => {
    alerts.dismiss(FOLDER_RENAME_ERROR_ID);
    setIsRenaming(true);
    alerts.upsert(FOLDER_RENAME_BUSY_ID, {
      tone: "warning",
      dismissible: false,
      message: (
        <IndexingStatusMessage label="Переименовываю папку и всё содержимое…" />
      ),
    });
    try {
      const newPath = await renameFolderLeaf(folderPath, newLeafName);
      alerts.dismiss(FOLDER_RENAME_BUSY_ID);
      setIsRenaming(false);
      setRenameSourcePath(null);
      refreshVault();
      const next = rewriteFolderNavFilterAfterMove(
        activeFilter,
        folderPath,
        newPath,
      );
      if (next) {
        onSelect(next);
      }
    } catch (error) {
      alerts.dismiss(FOLDER_RENAME_BUSY_ID);
      setIsRenaming(false);
      alerts.upsert(FOLDER_RENAME_ERROR_ID, {
        tone: "danger",
        message: errorMessage(error),
      });
    }
  };

  const handleConfirmCreateChild = async (
    parentPath: string,
    leafName: string,
  ) => {
    alerts.dismiss(FOLDER_CREATE_ERROR_ID);
    setIsCreatingFolder(true);
    alerts.upsert(FOLDER_CREATE_BUSY_ID, {
      tone: "warning",
      dismissible: false,
      message: <IndexingStatusMessage label="Создаю папку…" />,
    });
    try {
      const fullPath = buildChildFolderPath(parentPath, leafName);
      const newPath =
        await getCollectorService().folders.createFolder(fullPath);
      alerts.dismiss(FOLDER_CREATE_BUSY_ID);
      setIsCreatingFolder(false);
      setCreateParentPath(null);
      setCreateLeafValue("");
      refreshVault();
      onSelect({ type: "folder", folderPath: newPath });
    } catch (error) {
      alerts.dismiss(FOLDER_CREATE_BUSY_ID);
      setIsCreatingFolder(false);
      alerts.upsert(FOLDER_CREATE_ERROR_ID, {
        tone: "danger",
        message: errorMessage(error),
      });
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {folders.map((folder) => (
        <CollectionFolderRow
          key={folder.path}
          node={folder}
          activeKey={activeKey}
          isSettings={isSettings}
          onSelect={onSelect}
          onAction={handleFolderAction}
        />
      ))}
      {moveSourcePath !== null ? (
        <MoveFolderDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setMoveSourcePath(null);
            }
          }}
          folderPath={moveSourcePath}
          vaultRevision={vaultRevision}
          onConfirm={(newParentPath) => {
            const source = moveSourcePath;
            setMoveSourcePath(null);
            void handleConfirmMove(source, newParentPath);
          }}
        />
      ) : null}
      {renameSourcePath !== null ? (
        <RenameFolderDialog
          open
          folderPath={renameSourcePath}
          renameValue={renameValue}
          isRenaming={isRenaming}
          onRenameValueChange={setRenameValue}
          onOpenChange={(open) => {
            if (!open && !isRenaming) {
              setRenameSourcePath(null);
            }
          }}
          onCancel={() => {
            if (!isRenaming) {
              setRenameSourcePath(null);
            }
          }}
          onConfirm={() => {
            const source = renameSourcePath;
            void handleConfirmRename(source, renameValue);
          }}
        />
      ) : null}
      {createParentPath !== null ? (
        <CreateChildFolderDialog
          open
          parentPath={createParentPath}
          leafValue={createLeafValue}
          isCreating={isCreatingFolder}
          onLeafValueChange={setCreateLeafValue}
          onOpenChange={(open) => {
            if (!open && !isCreatingFolder) {
              setCreateParentPath(null);
              setCreateLeafValue("");
            }
          }}
          onCancel={() => {
            if (!isCreatingFolder) {
              setCreateParentPath(null);
              setCreateLeafValue("");
            }
          }}
          onConfirm={() => {
            const parent = createParentPath;
            void handleConfirmCreateChild(parent, createLeafValue);
          }}
        />
      ) : null}
    </div>
  );
}
