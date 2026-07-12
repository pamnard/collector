import { Archive, Inbox, Settings, Star, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { NavFilter } from "../../types/ui";
import { Logo } from "./Logo";
import { SidebarMenu } from "./SidebarMenu";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeFilter: NavFilter;
  onFilterSelect: (filter: NavFilter) => void;
}

const navItems: Array<{
  id: NavFilter;
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
}: SidebarProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isSettings = pathname === "/settings";

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
        <div className="p-4 px-6 flex items-center justify-between border-b border-border">
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
                    !isSettings && activeFilter === id
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
