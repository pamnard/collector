import { type ReactNode } from "react";
import { FolderPen, FolderTree } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export interface FolderContextMenuProps {
  folderPath: string;
  children: ReactNode;
  onRequestMove: (folderPath: string) => void;
  onRequestRename: (folderPath: string) => void;
}

export function FolderContextMenu({
  folderPath,
  children,
  onRequestMove,
  onRequestRename,
}: FolderContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block min-w-0">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => {
            onRequestRename(folderPath);
          }}
        >
          <FolderPen size={16} />
          Переименовать
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            onRequestMove(folderPath);
          }}
        >
          <FolderTree size={16} />
          Переместить папку в…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
