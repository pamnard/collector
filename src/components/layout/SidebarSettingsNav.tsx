import { Cable, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import {
  APP_SETTINGS_SECTIONS,
  PLUGIN_SETTINGS_SECTIONS,
  SETTINGS_NAV_GROUP_LABELS,
  SETTINGS_SECTION_LABELS,
  type SettingsSection,
} from "../../types/sidebar-mode";
import { TelegramBrandIcon } from "../TelegramBrandIcon";

interface SidebarSettingsNavProps {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

const SECTION_ICONS: Record<SettingsSection, ReactNode> = {
  general: <Settings2 size={16} />,
  mcp: <Cable size={16} />,
  telegram: <TelegramBrandIcon className="size-4" aria-hidden />,
};

function SettingsNavItem({
  id,
  selected,
  onSelect,
}: {
  id: SettingsSection;
  selected: boolean;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        selected
          ? "bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-400"
          : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
      }`}
    >
      {SECTION_ICONS[id]}
      <span>{SETTINGS_SECTION_LABELS[id]}</span>
    </button>
  );
}

export function SidebarSettingsNav({
  section,
  onSectionChange,
}: SidebarSettingsNavProps) {
  return (
    <div className="space-y-3 px-2 pb-2">
      <div className="space-y-1">
        {APP_SETTINGS_SECTIONS.map((id) => (
          <SettingsNavItem
            key={id}
            id={id}
            selected={section === id}
            onSelect={onSectionChange}
          />
        ))}
      </div>

      <div className="space-y-1">
        <div className="px-3 pt-1 pb-1 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
          {SETTINGS_NAV_GROUP_LABELS.plugins}
        </div>
        {PLUGIN_SETTINGS_SECTIONS.map((id) => (
          <SettingsNavItem
            key={id}
            id={id}
            selected={section === id}
            onSelect={onSectionChange}
          />
        ))}
      </div>
    </div>
  );
}
