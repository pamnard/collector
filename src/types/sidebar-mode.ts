export type SidebarMode = "collections" | "tags" | "search" | "settings";

export type SettingsSection = "general" | "mcp";

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: "Общие",
  mcp: "MCP",
};

export function parseSettingsSection(
  value: string | null,
): SettingsSection {
  if (value === "mcp") {
    return "mcp";
  }
  return "general";
}
