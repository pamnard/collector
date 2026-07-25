import { Folder, FolderOpen, Inbox } from "lucide-react";
import { useMemo } from "react";
import type { FolderTreeNode } from "@collector/core";
import { isInboxFolderName } from "@collector/shared";
import { useFolderTree } from "../../hooks/useFolderTree";
import type { NavFilter } from "../../types/ui";
import { navFilterKey } from "../../types/ui";

function flattenFolders(nodes: FolderTreeNode[]): FolderTreeNode[] {
  const flat: FolderTreeNode[] = [];
  const visit = (node: FolderTreeNode) => {
    flat.push(node);
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const node of nodes) {
    visit(node);
  }
  return flat;
}

function collectionButtonClass(selected: boolean): string {
  return `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
    selected
      ? "bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-400"
      : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
  }`;
}

interface SidebarCollectionsProps {
  activeFilter: NavFilter;
  isSettings: boolean;
  onSelect: (filter: NavFilter) => void;
  vaultRevision: number;
}

export function SidebarCollections({
  activeFilter,
  isSettings,
  onSelect,
  vaultRevision,
}: SidebarCollectionsProps) {
  const folders = useFolderTree(vaultRevision);
  const activeKey = navFilterKey(activeFilter);
  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);

  return (
    <div className="space-y-1">
      {flatFolders.map((folder) => {
        const filter: NavFilter = { type: "folder", folderPath: folder.path };
        const selected = !isSettings && activeKey === navFilterKey(filter);
        const inbox = isInboxFolderName(folder.name);
        const Icon = inbox ? Inbox : selected ? FolderOpen : Folder;
        return (
          <button
            key={folder.path}
            type="button"
            onClick={() => onSelect(filter)}
            className={collectionButtonClass(selected)}
          >
            <Icon size={18} />
            <span className="truncate">{folder.name}</span>
            <span className="ml-auto text-sm text-neutral-500/65">
              {folder.item_count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
