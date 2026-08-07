import { type ReactNode } from "react";
import { FolderTree } from "lucide-react";
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
}

export function FolderContextMenu({
  folderPath,
  children,
  onRequestMove,
}: FolderContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block min-w-0">{children}</ContextMenuTrigger>
      <ContextMenuContent>
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
