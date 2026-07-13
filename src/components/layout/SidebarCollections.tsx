import { Folder } from "lucide-react";
import { useMemo } from "react";
import type { FolderTreeNode } from "@collector/core";
import { useFolderTree } from "../../hooks/useFolderTree";
import type { NavFilter } from "../../types/ui";
import { navFilterKey } from "../../types/ui";

const UNCATEGORIZED_FILTER: NavFilter = { type: "folder", folderPath: "" };

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
  return `w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
    selected
      ? "bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-400"
      : "text-secondary hover:bg-input hover:text-primary"
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
      <button
        type="button"
        onClick={() => onSelect(UNCATEGORIZED_FILTER)}
        className={collectionButtonClass(
          !isSettings && activeKey === navFilterKey(UNCATEGORIZED_FILTER),
        )}
      >
        <Folder size={18} className="opacity-50" />
        <span className="truncate">Без коллекции</span>
      </button>

      {flatFolders.map((folder) => {
        const filter: NavFilter = { type: "folder", folderPath: folder.path };
        const selected = !isSettings && activeKey === navFilterKey(filter);
        return (
          <button
            key={folder.path}
            type="button"
            onClick={() => onSelect(filter)}
            className={collectionButtonClass(selected)}
          >
            <Folder size={18} />
            <span className="truncate">{folder.name}</span>
            <span className="ml-auto text-xs text-muted group-hover:text-secondary">
              {folder.item_count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
