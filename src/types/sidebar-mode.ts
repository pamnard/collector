export type SidebarMode = "collections" | "tags" | "search" | "settings";

/** App settings vs sync plugins — separate nav groups (Obsidian-style). */
export type SettingsSection = "general" | "mcp" | "telegram";

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: "Общие",
  mcp: "MCP",
  telegram: "Telegram",
};

export const APP_SETTINGS_SECTIONS = ["general", "mcp"] as const satisfies readonly SettingsSection[];

export const PLUGIN_SETTINGS_SECTIONS = [
  "telegram",
] as const satisfies readonly SettingsSection[];

export const SETTINGS_NAV_GROUP_LABELS = {
  plugins: "Плагины",
} as const;

export function isPluginSettingsSection(
  section: SettingsSection,
): boolean {
  return (PLUGIN_SETTINGS_SECTIONS as readonly string[]).includes(section);
}

export function parseSettingsSection(
  value: string | null,
): SettingsSection {
  if (value === "mcp") {
    return "mcp";
  }
  if (value === "telegram") {
    return "telegram";
  }
  return "general";
}
