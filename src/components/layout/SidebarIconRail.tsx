import { Folder, FolderBookmark, Hash, Moon, Search, Settings, Sun } from "lucide-react";
import type { Theme } from "../../hooks/useTheme";
import type { SidebarMode } from "../../types/sidebar-mode";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

interface SidebarIconRailProps {
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

const NAV_ITEMS: Array<{
  mode: Exclude<SidebarMode, "settings">;
  label: string;
  icon: typeof Folder;
}> = [
  { mode: "collections", label: "Коллекции", icon: Folder },
  { mode: "tags", label: "Теги", icon: Hash },
  { mode: "search", label: "Поиск", icon: Search },
];

const railButtonClassName =
  "!size-12 max-w-none justify-center rounded-none p-0 text-neutral-500 hover:bg-transparent hover:text-neutral-500 dark:text-neutral-400 dark:hover:bg-transparent dark:hover:text-neutral-400 active:bg-transparent dark:active:bg-transparent data-active:bg-transparent data-active:text-neutral-500 dark:data-active:bg-transparent dark:data-active:text-neutral-400 data-open:hover:bg-transparent dark:data-open:hover:bg-transparent [&_svg]:size-5";

export function SidebarIconRail({
  mode,
  onModeChange,
  theme,
  onToggleTheme,
}: SidebarIconRailProps) {
  const themeLabel =
    theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему";

  return (
    <div className="flex h-full shrink-0">
      <div className="flex h-full w-12 flex-col bg-neutral-200 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
        <div className="flex h-12 shrink-0 items-center justify-center border-b border-black/10 dark:border-white/10">
          <FolderBookmark
            size={20}
            strokeWidth={2.5}
            className="text-indigo-500"
            aria-hidden
          />
          <span className="sr-only">Collector</span>
        </div>

        <SidebarContent className="px-0">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.mode}>
                    <SidebarMenuButton
                      tooltip={{ children: item.label, hidden: false }}
                      isActive={mode === item.mode}
                      onClick={() => onModeChange(item.mode)}
                      className={railButtonClassName}
                    >
                      <item.icon size={20} strokeWidth={2.5} />
                      <span className="sr-only">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={{ children: themeLabel, hidden: false }}
                isActive={false}
                onClick={onToggleTheme}
                className={railButtonClassName}
              >
                {theme === "dark" ? (
                  <Sun size={20} strokeWidth={2.5} />
                ) : (
                  <Moon size={20} strokeWidth={2.5} />
                )}
                <span className="sr-only">{themeLabel}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={{ children: "Настройки", hidden: false }}
                isActive={mode === "settings"}
                onClick={() => onModeChange("settings")}
                className={railButtonClassName}
              >
                <Settings size={20} strokeWidth={2.5} />
                <span className="sr-only">Настройки</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </div>
      <div
        aria-hidden
        className="w-px shrink-0 self-stretch bg-black/10 dark:bg-white/10"
      />
    </div>
  );
}
