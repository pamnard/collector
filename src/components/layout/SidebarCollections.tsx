import { Folder } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { listDashboardItemIds, listFolderTree } from "../../services/collector-service";
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
  const [folders, setFolders] = useState<FolderTreeNode[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const activeKey = navFilterKey(activeFilter);
  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);

  useEffect(() => {
    void Promise.all([
      listFolderTree().then(setFolders),
      listDashboardItemIds(UNCATEGORIZED_FILTER).then((ids) =>
        setUncategorizedCount(ids.length),
      ),
    ]).catch(() => {
      setFolders([]);
      setUncategorizedCount(0);
    });
  }, [vaultRevision]);

  const rowClass = (selected: boolean) =>
    `w-full flex items-center justify-between gap-3 px-2 py-1 transition-colors ${
      selected ? "text-primary" : "text-secondary hover:text-primary"
    }`;

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => onSelect(UNCATEGORIZED_FILTER)}
        className={rowClass(
          !isSettings && activeKey === navFilterKey(UNCATEGORIZED_FILTER),
        )}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <Folder size={16} strokeWidth={1.5} className="shrink-0 opacity-70" />
          <span className="truncate">Без коллекции</span>
        </span>
        {uncategorizedCount > 0 && (
          <span className="text-xs text-muted tabular-nums">{uncategorizedCount}</span>
        )}
      </button>

      {flatFolders.map((folder) => {
        const filter: NavFilter = { type: "folder", folderPath: folder.path };
        const selected = !isSettings && activeKey === navFilterKey(filter);
        return (
          <button
            key={folder.path}
            type="button"
            onClick={() => onSelect(filter)}
            className={rowClass(selected)}
          >
            <span className="inline-flex items-center gap-2 min-w-0">
              <Folder size={16} strokeWidth={1.5} className="shrink-0 opacity-70" />
              <span className="truncate">{folder.name}</span>
            </span>
            <span className="text-xs text-muted tabular-nums">{folder.item_count}</span>
          </button>
        );
      })}
    </div>
  );
}
