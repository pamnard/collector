import type { DerivedCatchUpStatus } from "@collector/api";

/** Label for the derived index catch-up alert (#767). */
export function formatDerivedCatchUpBannerLabel(
  status: DerivedCatchUpStatus,
): string {
  const total = status.pending + status.running;
  if (total <= 1) {
    return "Обновление индекса…";
  }
  return `Обновление индекса… ${total}`;
}
