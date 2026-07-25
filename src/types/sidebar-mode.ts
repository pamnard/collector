export type SidebarMode = "collections" | "tags" | "search" | "settings";

export type SettingsSection = "general" | "mcp";

export function parseSettingsSection(
  value: string | null,
): SettingsSection {
  if (value === "mcp") {
    return "mcp";
  }
  return "general";
}
