export type ShellLayoutAlertDecision = "upsert" | "dismiss";

export function dashboardLoadingAlertDecision(
  isLoading: boolean,
): ShellLayoutAlertDecision {
  return isLoading ? "upsert" : "dismiss";
}

export function indexingAlertDecision(
  isMetadataIndexing: boolean,
): ShellLayoutAlertDecision {
  return isMetadataIndexing ? "upsert" : "dismiss";
}

export function dashboardErrorAlertDecision(
  dashboardError: string | null,
  dismissedError: string | null,
): ShellLayoutAlertDecision {
  if (dashboardError === null || dashboardError === dismissedError) {
    return "dismiss";
  }
  return "upsert";
}

export function updateAlertDecision(
  startupUpdateVersion: string | null,
): ShellLayoutAlertDecision {
  return startupUpdateVersion !== null ? "upsert" : "dismiss";
}

export const SHELL_LAYOUT_ALERT_IDS = {
  loading: "layout-dashboard-loading",
  indexing: "layout-indexing",
  error: "layout-dashboard-error",
  update: "layout-update",
} as const;
