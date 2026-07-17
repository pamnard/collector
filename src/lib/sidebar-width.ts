export const SIDEBAR_WIDTH_MIN = 240;
export const SIDEBAR_WIDTH_DEFAULT = 288;
export const SIDEBAR_WIDTH_MAX = 400;
export const SIDEBAR_WIDTH_STORAGE_KEY = "collector.sidebarWidthPx";

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
