import { ChevronDown, ChevronRight, Folder, FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import {
  createFolder,
  listFolderTree,
} from "../../services/collector-service";
import { useFolderTree } from "../../hooks/useFolderTree";
import type { NavFilter } from "../../types/ui";
import { navFilterKey } from "../../types/ui";

interface FolderTreeProps {
  activeFilter: NavFilter;
  onFilterSelect: (filter: NavFilter) => void;
  vaultRevision: number;
  isSettings: boolean;
  onNavigate: () => void;
}

function FolderTreeNodeView({
  node,
  depth,
  activeKey,
  isSettings,
  onSelect,
}: {
  node: FolderTreeNode;
  depth: number;
  activeKey: string;
  isSettings: boolean;
  onSelect: (filter: NavFilter) => void;
}) {
  const [open, setOpen] = useState(true);
  const filter: NavFilter = { type: "folder", folderPath: node.path };
  const selected = !isSettings && activeKey === navFilterKey(filter);

  return (
    <div>
      <div
        className="flex items-center gap-1"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded p-0.5 text-muted hover:text-primary"
            aria-label={open ? "Свернуть" : "Развернуть"}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button
          type="button"
          onClick={() => onSelect(filter)}
          className={`flex-1 flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg transition-colors ${
            selected
              ? "bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-400"
              : "text-secondary hover:bg-input hover:text-primary"
          }`}
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <Folder size={16} className="shrink-0" />
            <span className="truncate">{node.name}</span>
          </span>
          <span className="text-sm text-muted">{node.item_count}</span>
        </button>
      </div>
      {open &&
        node.children.map((child) => (
          <FolderTreeNodeView
            key={child.path}
            node={child}
            depth={depth + 1}
            activeKey={activeKey}
            isSettings={isSettings}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export function FolderTree({
  activeFilter,
  onFilterSelect,
  vaultRevision,
  isSettings,
  onNavigate,
}: FolderTreeProps) {
  const indexTree = useFolderTree(vaultRevision);
  const [tree, setTree] = useState<FolderTreeNode[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const activeKey = navFilterKey(activeFilter);

  useEffect(() => {
    setTree(indexTree);
  }, [indexTree]);

  const handleSelect = (filter: NavFilter) => {
    onFilterSelect(filter);
    onNavigate();
  };

  const handleCreate = async () => {
    const path = newFolder.trim();
    if (!path) {
      return;
    }

    setError(null);
    try {
      await createFolder(path);
      setNewFolder("");
      setTree(await listFolderTree());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={newFolder}
          onChange={(event) => setNewFolder(event.target.value)}
          placeholder="Work/Articles"
          className="flex-1 rounded-lg border border-border bg-input/20 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={!newFolder.trim()}
          className="rounded-lg border border-border p-1.5 text-secondary hover:bg-input/65 disabled:opacity-50"
          aria-label="Создать папку"
        >
          <FolderPlus size={16} />
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {tree.map((node) => (
        <FolderTreeNodeView
          key={node.path}
          node={node}
          depth={0}
          activeKey={activeKey}
          isSettings={isSettings}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}
