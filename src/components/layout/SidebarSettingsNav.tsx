import { Cable, Settings2 } from "lucide-react";
import type { SettingsSection } from "../../types/sidebar-mode";

interface SidebarSettingsNavProps {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof Settings2;
}> = [
  { id: "general", label: "Общие", icon: Settings2 },
  { id: "mcp", label: "МЦП", icon: Cable },
];

export function SidebarSettingsNav({
  section,
  onSectionChange,
}: SidebarSettingsNavProps) {
  return (
    <div className="space-y-1 px-2">
      {SECTIONS.map((item) => {
        const selected = section === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSectionChange(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              selected
                ? "bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-400"
                : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
            }`}
          >
            <Icon size={16} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
