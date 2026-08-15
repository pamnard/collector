import {
  FileCheck,
  FolderInput,
  MoreVertical,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  groupItemActions,
  listEnabledItemActions,
  type ItemActionId,
} from "../../lib/item-action-catalog";
import { headerChromeBtn } from "../layout/header-chrome";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const ITEM_ACTION_ICONS: Record<ItemActionId, LucideIcon> = {
  move: FolderInput,
  rename: Pencil,
  lint: FileCheck,
  delete: Trash2,
};

export type ItemActionsMenuTriggerVariant = "header" | "row";

export interface ItemActionsMenuProps {
  disabled?: boolean;
  triggerVariant?: ItemActionsMenuTriggerVariant;
  onAction: (id: ItemActionId) => void;
}

export function ItemActionsMenu({
  disabled = false,
  triggerVariant = "row",
  onAction,
}: ItemActionsMenuProps) {
  const sections = groupItemActions(listEnabledItemActions());

  const triggerButton =
    triggerVariant === "header" ? (
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label="Действия"
        title="Действия"
        disabled={disabled}
        className={cn("border-transparent", headerChromeBtn)}
      />
    ) : (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Действия"
        disabled={disabled}
        className="text-neutral-500 dark:text-neutral-400"
      />
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={triggerButton}>
        <MoreVertical size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-52">
        {sections.map((section, sectionIndex) => (
          <div key={`${section[0].group}-${sectionIndex}`}>
            {sectionIndex > 0 ? <DropdownMenuSeparator /> : null}
            {section.map((action) => {
              const Icon = ITEM_ACTION_ICONS[action.id];
              return (
                <DropdownMenuItem
                  key={action.id}
                  variant={action.id === "delete" ? "destructive" : "default"}
                  disabled={disabled}
                  className="whitespace-nowrap"
                  onClick={() => {
                    onAction(action.id);
                  }}
                >
                  <Icon size={16} />
                  {action.label}
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
