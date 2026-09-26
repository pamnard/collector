import {
  parseSettingsSection,
  type SettingsSection,
} from "../../types/sidebar-mode.ts";

export type AppLayoutHeaderVariant =
  | "list"
  | "settings"
  | "item"
  | "wanted-links";

export type AppLayoutRouteChrome = {
  isItemRoute: boolean;
  isSettingsRoute: boolean;
  isWantedLinksRoute: boolean;
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
  const isWantedLinksRoute = pathname === "/links/wanted";
  const settingsSection = parseSettingsSection(sectionParam);
  const showCardHeader =
    pathname === "/" || isItemRoute || isSettingsRoute || isWantedLinksRoute;
  const headerVariant: AppLayoutHeaderVariant =
    pathname === "/"
      ? "list"
      : isSettingsRoute
        ? "settings"
        : isWantedLinksRoute
          ? "wanted-links"
          : "item";
  return {
    isItemRoute,
    isSettingsRoute,
    isWantedLinksRoute,
    settingsSection,
    showCardHeader,
    headerVariant,
  };
}
