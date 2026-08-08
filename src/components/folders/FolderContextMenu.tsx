import { type ReactNode } from "react";
import {
  FilePlus,
  FolderPen,
  FolderPlus,
  FolderTree,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  groupFolderActions,
  listEnabledFolderActions,
  type FolderActionId,
} from "../../lib/folder-action-catalog";

const FOLDER_ACTION_ICONS: Record<FolderActionId, LucideIcon> = {
  "new-note": FilePlus,
  "new-folder": FolderPlus,
  move: FolderTree,
  rename: FolderPen,
  delete: Trash2,
};

export interface FolderContextMenuProps {
  folderPath: string;
  children: ReactNode;
  onAction: (id: FolderActionId, folderPath: string) => void;
}

export function FolderContextMenu({
  folderPath,
  children,
  onAction,
}: FolderContextMenuProps) {
  const sections = groupFolderActions(listEnabledFolderActions(folderPath));

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block min-w-0">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {sections.map((section, sectionIndex) => (
          <div key={section[0]?.group ?? sectionIndex}>
            {sectionIndex > 0 ? <ContextMenuSeparator /> : null}
            {section.map((action) => {
              const Icon = FOLDER_ACTION_ICONS[action.id];
              return (
                <ContextMenuItem
                  key={action.id}
                  variant={action.id === "delete" ? "destructive" : "default"}
                  onClick={() => {
                    onAction(action.id, folderPath);
                  }}
                >
                  <Icon size={16} />
                  {action.label}
                </ContextMenuItem>
              );
            })}
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
