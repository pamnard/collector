import { useEffect, useState } from "react";
import { Archive, Inbox, Settings, Star, Tag, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { TagWithCount } from "@collector/core";
import { listTags } from "../../services/collector-service";
import type { NavFilter } from "../../types/ui";
import { navFilterKey } from "../../types/ui";
import { Logo } from "./Logo";
import { SidebarMenu } from "./SidebarMenu";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeFilter: NavFilter;
  onFilterSelect: (filter: NavFilter) => void;
  vaultRevision: number;
}

const navItems: Array<{
  id: "all" | "favorite" | "archived";
  label: string;
  icon: typeof Inbox;
}> = [
  { id: "all", label: "Все", icon: Inbox },
  { id: "favorite", label: "Избранное", icon: Star },
  { id: "archived", label: "Архив", icon: Archive },
];

export function Sidebar({
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

  useEffect(() => {
    listTags()
      .then(setTags)
      .catch(() => setTags([]));
  }, [vaultRevision]);

  const activeKey = navFilterKey(activeFilter);

  const goToDashboard = (filter: NavFilter) => {
    onFilterSelect(filter);
    navigate("/");
    onClose();
  };

  const goToSettings = () => {
    navigate("/settings");
    onClose();
  };

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="Закрыть меню"
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-border flex flex-col transition-transform duration-300 ease-in-out shrink-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="h-16 px-6 flex items-center justify-between border-b border-border shrink-0">
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

        <nav className="flex-1 px-4 overflow-y-auto custom-scrollbar">
          <SidebarMenu title="Обзор">
            <div className="space-y-1">
              {navItems.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => goToDashboard(id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    !isSettings && activeKey === id
                      ? "bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-400"
                      : "text-secondary hover:bg-input hover:text-primary"
                  }`}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </SidebarMenu>

          {tags.length > 0 && (
            <SidebarMenu title="Теги">
              <div className="space-y-1">
                {tags.map((tag) => {
                  const filter: NavFilter = { type: "tag", tagId: tag.id };
                  const selected =
                    !isSettings && activeKey === navFilterKey(filter);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => goToDashboard(filter)}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-colors ${
                        selected
                          ? "bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-400"
                          : "text-secondary hover:bg-input hover:text-primary"
                      }`}
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <Tag size={16} className="shrink-0" />
                        <span className="truncate">{tag.name}</span>
                      </span>
                      <span className="text-xs text-muted">{tag.item_count}</span>
                    </button>
                  );
                })}
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
