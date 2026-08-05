export const DETAIL_HERO_EXPANDED_STORAGE_KEY = "collector.detailHeroExpanded";

export function readDetailHeroExpanded(): boolean {
  const raw = localStorage.getItem(DETAIL_HERO_EXPANDED_STORAGE_KEY);
  if (raw === null) {
    return true;
  }
  if (raw === "0") {
    return false;
  }
  if (raw === "1") {
    return true;
  }
  return true;
}

export function writeDetailHeroExpanded(expanded: boolean): void {
  localStorage.setItem(DETAIL_HERO_EXPANDED_STORAGE_KEY, expanded ? "1" : "0");
}
