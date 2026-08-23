import {
  parseSettingsSection,
  type SettingsSection,
} from "../../types/sidebar-mode.ts";

export type AppLayoutHeaderVariant = "list" | "settings" | "item";

export type AppLayoutRouteChrome = {
  isItemRoute: boolean;
  isSettingsRoute: boolean;
  settingsSection: SettingsSection;
  showCardHeader: boolean;
  headerVariant: AppLayoutHeaderVariant;
};

export function resolveAppLayoutRouteChrome(
  pathname: string,
  sectionParam: string | null,
): AppLayoutRouteChrome {
  const isItemRoute = pathname.startsWith("/item/");
  const isSettingsRoute = pathname === "/settings";
  const settingsSection = parseSettingsSection(sectionParam);
  const showCardHeader = pathname === "/" || isItemRoute || isSettingsRoute;
  const headerVariant: AppLayoutHeaderVariant =
    pathname === "/"
      ? "list"
      : isSettingsRoute
        ? "settings"
        : "item";
  return {
    isItemRoute,
    isSettingsRoute,
    settingsSection,
    showCardHeader,
    headerVariant,
  };
}
