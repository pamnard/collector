import { ChevronDown, ChevronRight, Folder, FolderOpen, Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { isInboxFolderName } from "@collector/shared";
import { Badge } from "@/components/ui/badge";
import { useFolderTree } from "../../hooks/useFolderTree";
import type { NavFilter } from "../../types/ui";
import { navFilterKey } from "../../types/ui";

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
}: {
  node: FolderTreeNode;
  activeKey: string;
  isSettings: boolean;
  onSelect: (filter: NavFilter) => void;
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
      {open && hasChildren ? (
        <div className={NEST_LIST_CLASS}>
          {node.children.map((child) => (
            <CollectionFolderRow
              key={child.path}
              node={child}
              activeKey={activeKey}
              isSettings={isSettings}
              onSelect={onSelect}
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

export function SidebarCollections({
  activeFilter,
  isSettings,
  onSelect,
  vaultRevision,
}: SidebarCollectionsProps) {
  const folders = useFolderTree(vaultRevision);
  const activeKey = navFilterKey(activeFilter);

  return (
    <div className="flex flex-col gap-1">
      {folders.map((folder) => (
        <CollectionFolderRow
          key={folder.path}
          node={folder}
          activeKey={activeKey}
          isSettings={isSettings}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
