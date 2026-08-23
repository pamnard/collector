import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Inbox,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { isInboxFolderName } from "@collector/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../alerts/AlertBusProvider";
import { runWithBusyAlert } from "../alerts/run-with-busy-alert";
import { useFolderTree } from "../../hooks/useFolderTree";
import type { FolderActionId } from "../../lib/folder-action-catalog";
import {
  clearFolderNavFilterAfterDelete,
  createChildFolder,
  deleteFolderAt,
  folderLeafName,
  moveFolderTo,
  renameFolderLeaf,
  rewriteFolderNavFilterAfterMove,
} from "../../lib/folder-actions";
import type { NavFilter } from "../../types/ui";
import { isFolderFilter, navFilterKey } from "../../types/ui";
import { CreateFolderDialog } from "../folders/CreateFolderDialog";
import { FolderContextMenu } from "../folders/FolderContextMenu";
import { FolderLeafNameDialog } from "../folders/FolderLeafNameDialog";
import { MoveFolderDialog } from "../folders/MoveFolderDialog";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { useShell } from "./AppLayout";

const FOLDER_MOVE_BUSY_ID = "folder-move-busy";
const FOLDER_MOVE_ERROR_ID = "folder-move-error";
const FOLDER_RENAME_BUSY_ID = "folder-rename-busy";
const FOLDER_RENAME_ERROR_ID = "folder-rename-error";
const FOLDER_CREATE_BUSY_ID = "folder-create-busy";
const FOLDER_CREATE_ERROR_ID = "folder-create-error";
const FOLDER_DELETE_BUSY_ID = "folder-delete-busy";
const FOLDER_DELETE_ERROR_ID = "folder-delete-error";

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
            data-dashboard-folder-path={node.path}
            onClick={() => onSelect(filter)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left"
          >
            <Icon size={18} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            <Badge
              variant="ghost"
              className="h-5 min-w-5 shrink-0 px-1.5 text-xs tabular-nums text-neutral-500 dark:text-neutral-400"
            >
              {node.item_count}
            </Badge>
          </button>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-black/10 text-neutral-500 hover:bg-black/10 hover:text-neutral-900 dark:bg-white/10 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-100"
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
}

type LeafDialog =
  | { kind: "rename"; path: string }
  | { kind: "create"; path: string };

export function SidebarCollections({
  activeFilter,
  isSettings,
  onSelect,
  vaultRevision,
}: SidebarCollectionsProps) {
  const { openCreate } = useShell();
  const folders = useFolderTree(vaultRevision);
  const activeKey = navFilterKey(activeFilter);
  const alerts = useAlerts();
  const [moveSourcePath, setMoveSourcePath] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [leafDialog, setLeafDialog] = useState<LeafDialog | null>(null);
  const [leafBusy, setLeafBusy] = useState(false);
  const [deleteSourcePath, setDeleteSourcePath] = useState<string | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const defaultCreateParentPath = isFolderFilter(activeFilter)
    ? activeFilter.folderPath
    : "";

  useDismissAlertsOnUnmount([
    FOLDER_MOVE_BUSY_ID,
    FOLDER_MOVE_ERROR_ID,
    FOLDER_RENAME_BUSY_ID,
    FOLDER_RENAME_ERROR_ID,
    FOLDER_CREATE_BUSY_ID,
    FOLDER_CREATE_ERROR_ID,
    FOLDER_DELETE_BUSY_ID,
    FOLDER_DELETE_ERROR_ID,
  ]);

  const handleFolderAction = (id: FolderActionId, path: string) => {
    if (id === "new-note") {
      openCreate(path);
      return;
    }
    if (id === "new-folder") {
      setLeafDialog({ kind: "create", path });
      return;
    }
    if (id === "rename") {
      setLeafDialog({ kind: "rename", path });
      return;
    }
    if (id === "move") {
      setMoveSourcePath(path);
      return;
    }
    if (id === "delete") {
      setDeleteSourcePath(path);
    }
  };

  const applyNavRewrite = (next: NavFilter | null) => {
    if (next) {
      onSelect(next);
    }
  };

  const handleConfirmMove = async (
    folderPath: string,
    newParentPath: string,
  ) => {
    const newPath = await runWithBusyAlert(alerts, {
      busyId: FOLDER_MOVE_BUSY_ID,
      errorId: FOLDER_MOVE_ERROR_ID,
      label: "Перемещаю папку и всё содержимое…",
      run: () => moveFolderTo(folderPath, newParentPath),
    });
    if (newPath === undefined) {
      return;
    }
    applyNavRewrite(
      rewriteFolderNavFilterAfterMove(activeFilter, folderPath, newPath),
    );
  };

  const handleConfirmRename = async (folderPath: string, newLeafName: string) => {
    setLeafBusy(true);
    const newPath = await runWithBusyAlert(alerts, {
      busyId: FOLDER_RENAME_BUSY_ID,
      errorId: FOLDER_RENAME_ERROR_ID,
      label: "Переименовываю папку и всё содержимое…",
      run: () => renameFolderLeaf(folderPath, newLeafName),
    });
    setLeafBusy(false);
    if (newPath === undefined) {
      return;
    }
    setLeafDialog(null);
    applyNavRewrite(
      rewriteFolderNavFilterAfterMove(activeFilter, folderPath, newPath),
    );
  };

  const handleConfirmCreateChild = async (
    parentPath: string,
    leafName: string,
  ) => {
    setLeafBusy(true);
    const newPath = await runWithBusyAlert(alerts, {
      busyId: FOLDER_CREATE_BUSY_ID,
      errorId: FOLDER_CREATE_ERROR_ID,
      label: "Создаю папку…",
      run: () => createChildFolder(parentPath, leafName),
    });
    setLeafBusy(false);
    if (newPath === undefined) {
      return;
    }
    setLeafDialog(null);
    setCreateFolderOpen(false);
    onSelect({ type: "folder", folderPath: newPath });
  };

  const handleConfirmDelete = async (folderPath: string) => {
    setIsDeletingFolder(true);
    try {
      await runWithBusyAlert(alerts, {
        busyId: FOLDER_DELETE_BUSY_ID,
        errorId: FOLDER_DELETE_ERROR_ID,
        label: "Удаляю папку и всё содержимое…",
        rethrow: true,
        run: () => deleteFolderAt(folderPath),
      });
      setDeleteSourcePath(null);
      applyNavRewrite(clearFolderNavFilterAfterDelete(activeFilter, folderPath));
    } finally {
      setIsDeletingFolder(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 flex items-center gap-0.5 px-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="bg-transparent dark:bg-transparent"
          aria-label="Новая заметка"
          title="Новая заметка"
          onClick={() =>
            openCreate(
              isFolderFilter(activeFilter)
                ? activeFilter.folderPath
                : undefined,
            )
          }
        >
          <FilePlus size={16} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="bg-transparent dark:bg-transparent"
          aria-label="Новая папка"
          title="Новая папка"
          onClick={() => setCreateFolderOpen(true)}
        >
          <FolderPlus size={16} />
        </Button>
      </div>
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
      {createFolderOpen ? (
        <CreateFolderDialog
          open
          busy={leafBusy}
          tree={folders}
          initialParentPath={defaultCreateParentPath}
          onOpenChange={(open) => {
            if (!open && !leafBusy) {
              setCreateFolderOpen(false);
            }
          }}
          onConfirm={(parentPath, leafName) => {
            void handleConfirmCreateChild(parentPath, leafName);
          }}
        />
      ) : null}
      {moveSourcePath !== null ? (
        <MoveFolderDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setMoveSourcePath(null);
            }
          }}
          folderPath={moveSourcePath}
          tree={folders}
          onConfirm={(newParentPath) => {
            const source = moveSourcePath;
            setMoveSourcePath(null);
            void handleConfirmMove(source, newParentPath);
          }}
        />
      ) : null}
      {leafDialog !== null ? (
        <FolderLeafNameDialog
          open
          busy={leafBusy}
          title={
            leafDialog.kind === "rename" ? "Переименовать папку" : "Новая папка"
          }
          description={
            leafDialog.kind === "rename"
              ? `Новое имя для «${folderLeafName(leafDialog.path)}».`
              : `Дочерняя папка внутри «${leafDialog.path}».`
          }
          confirmLabel={leafDialog.kind === "rename" ? "Сохранить" : "Создать"}
          initialValue={
            leafDialog.kind === "rename" ? folderLeafName(leafDialog.path) : ""
          }
          placeholder={
            leafDialog.kind === "create" ? "Имя папки" : undefined
          }
          onOpenChange={(open) => {
            if (!open && !leafBusy) {
              setLeafDialog(null);
            }
          }}
          onConfirm={(leaf) => {
            if (leafDialog.kind === "rename") {
              void handleConfirmRename(leafDialog.path, leaf);
              return;
            }
            void handleConfirmCreateChild(leafDialog.path, leaf);
          }}
        />
      ) : null}
      {deleteSourcePath !== null ? (
        <ConfirmDialog
          open
          busy={isDeletingFolder}
          title={folderLeafName(deleteSourcePath)}
          description={`Папка «${deleteSourcePath}» и все вложенные папки и элементы будут удалены без возможности восстановления.`}
          onOpenChange={(open) => {
            if (!open && !isDeletingFolder) {
              setDeleteSourcePath(null);
            }
          }}
          onConfirm={() => handleConfirmDelete(deleteSourcePath)}
        />
      ) : null}
    </div>
  );
}
