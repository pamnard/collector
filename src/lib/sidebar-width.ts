export const SIDEBAR_WIDTH_MIN = 240;
export const SIDEBAR_WIDTH_DEFAULT = 288;
export const SIDEBAR_WIDTH_MAX = 400;
/** Icon rail (w-12) + 1px divider — collapsed docked sidebar. */
export const SIDEBAR_RAIL_WIDTH_PX = 49;
export const SIDEBAR_WIDTH_STORAGE_KEY = "collector.sidebarWidthPx";
/** @deprecated Prefer pin preference; kept for one-time migration. */
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "collector.sidebarCollapsed";
export const SIDEBAR_PINNED_STORAGE_KEY = "collector.sidebarPinned";

export function clampSidebarWidthPx(value: number): number {
  if (!Number.isFinite(value)) {
    return SIDEBAR_WIDTH_DEFAULT;
  }
  return Math.min(
    SIDEBAR_WIDTH_MAX,
    Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)),
  );
}

export function readSidebarWidthPx(): number {
  const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (raw === null) {
    return SIDEBAR_WIDTH_DEFAULT;
  }
  return clampSidebarWidthPx(Number(raw));
}

export function writeSidebarWidthPx(value: number): void {
  localStorage.setItem(
    SIDEBAR_WIDTH_STORAGE_KEY,
    String(clampSidebarWidthPx(value)),
  );
}

export function readSidebarPinned(): boolean {
  const raw = localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY);
  if (raw !== null) {
    return raw === "1";
  }
  // Migrate: previously expanded (not collapsed) ≈ pinned open.
  const legacyCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
  if (legacyCollapsed === null) {
    return false;
  }
  return legacyCollapsed !== "1";
}

export function writeSidebarPinned(pinned: boolean): void {
  localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, pinned ? "1" : "0");
}
