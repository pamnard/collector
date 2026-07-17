import { useEffect, useState } from "react";
import { Hash, Settings, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { TagWithCount } from "@collector/core";
import { subscribeTags } from "../../services/collector-service";
import type { NavFilter } from "../../types/ui";
import { navFilterKey } from "../../types/ui";
import { Logo } from "./Logo";
import { SidebarCollections } from "./SidebarCollections";
import { SidebarMenu } from "./SidebarMenu";

interface SidebarProps {
  variant?: "drawer" | "docked";
  isOpen: boolean;
  onClose: () => void;
  activeFilter: NavFilter;
  onFilterSelect: (filter: NavFilter) => void;
  vaultRevision: number;
}

export function Sidebar({
  variant = "drawer",
  isOpen,
  onClose,
  activeFilter,
  onFilterSelect,
  vaultRevision,
}: SidebarProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isSettings = pathname === "/settings";
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const activeKey = navFilterKey(activeFilter);

  useEffect(() => {
    const controller = new AbortController();
    subscribeTags(setTags, undefined, controller.signal);
    return () => {
      controller.abort();
    };
  }, [vaultRevision]);

  const goToDashboard = (filter: NavFilter) => {
    onFilterSelect(filter);
    navigate("/");
    onClose();
  };

  const goToSettings = () => {
    navigate("/settings");
    onClose();
  };

  const isTagSelected = (tagId: string) =>
    !isSettings &&
    activeKey === navFilterKey({ type: "tag", tagId });

  return (
    <>
      {variant === "drawer" && isOpen && (
        <button
          type="button"
          aria-label="Закрыть меню"
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside
        className={
          variant === "docked"
            ? "flex h-full w-full flex-col bg-sidebar"
            : `fixed md:static inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-border flex flex-col transition-all duration-300 ease-in-out shrink-0 ${
                isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
              }`
        }
      >
        <div className="h-16 px-6 flex items-center justify-between border-b border-border shrink-0 box-border">
          <button
            type="button"
            onClick={() => goToDashboard("all")}
            className="hover:opacity-80 transition-opacity"
          >
            <Logo size="md" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="md:hidden text-secondary hover:text-primary"
            aria-label="Закрыть"
          >
            <X size={24} />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-6 overflow-y-auto custom-scrollbar">
          <SidebarMenu title="Коллекции">
            <SidebarCollections
              activeFilter={activeFilter}
              isSettings={isSettings}
              onSelect={goToDashboard}
              vaultRevision={vaultRevision}
            />
          </SidebarMenu>

          {tags.length > 0 && (
            <SidebarMenu title="Теги">
              <div className="flex flex-wrap gap-2 px-2">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      goToDashboard({ type: "tag", tagId: tag.id })
                    }
                    className={`flex items-center gap-1 text-sm transition-colors ${
                      isTagSelected(tag.id)
                        ? "text-indigo-600 dark:text-indigo-400"
                        : "text-muted hover:text-primary"
                    }`}
                  >
                    <Hash size={14} />
                    <span className="truncate max-w-[150px]">{tag.name}</span>
                  </button>
                ))}
              </div>
            </SidebarMenu>
          )}
        </nav>

        <div className="p-4 border-t border-border">
          <button
            type="button"
            onClick={goToSettings}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isSettings
                ? "bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-400"
                : "text-secondary hover:bg-input hover:text-primary"
            }`}
          >
            <Settings size={18} />
            <span>Настройки</span>
          </button>
        </div>
      </aside>
    </>
  );
}
