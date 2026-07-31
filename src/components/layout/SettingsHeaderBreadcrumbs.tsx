import { Settings2 } from "lucide-react";
import {
  SETTINGS_NAV_GROUP_LABELS,
  SETTINGS_SECTION_LABELS,
  isPluginSettingsSection,
  type SettingsSection,
} from "../../types/sidebar-mode";
import { cn } from "../../lib/utils";
import { headerPathChrome } from "./header-chrome";

interface SettingsHeaderBreadcrumbsProps {
  section: SettingsSection;
}

export function SettingsHeaderBreadcrumbs({
  section,
}: SettingsHeaderBreadcrumbsProps) {
  const sectionLabel = SETTINGS_SECTION_LABELS[section];
  const pluginGroup = isPluginSettingsSection(section);

  return (
    <nav
      aria-label="Путь"
      className={cn(
        headerPathChrome,
        "flex h-8 min-w-0 flex-1 items-center overflow-hidden",
      )}
    >
      <ol className="flex min-w-0 flex-1 items-center overflow-hidden text-sm">
        <li className="flex shrink-0 items-center overflow-hidden">
          <Settings2
            size={16}
            className="mr-3 shrink-0 text-neutral-500 dark:text-neutral-400"
            aria-hidden
          />
          <span
            className="text-neutral-500 dark:text-neutral-400"
            title="Настройки"
          >
            Настройки
          </span>
        </li>
        {pluginGroup ? (
          <li className="flex shrink-0 items-center overflow-hidden">
            <span
              className="mx-[1em] shrink-0 text-neutral-400 dark:text-neutral-500"
              aria-hidden
            >
              /
            </span>
            <span
              className="text-neutral-500 dark:text-neutral-400"
              title={SETTINGS_NAV_GROUP_LABELS.plugins}
            >
              {SETTINGS_NAV_GROUP_LABELS.plugins}
            </span>
          </li>
        ) : null}
        <li className="flex min-w-0 flex-1 items-center overflow-hidden">
          <span
            className="mx-[1em] shrink-0 text-neutral-400 dark:text-neutral-500"
            aria-hidden
          >
            /
          </span>
          <span
            className="min-w-0 flex-1 truncate font-medium text-neutral-900 dark:text-neutral-100"
            title={sectionLabel}
          >
            {sectionLabel}
          </span>
        </li>
      </ol>
    </nav>
  );
}
