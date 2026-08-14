import type { JobsPort } from "@collector/api";
import type { AlertsApi } from "../components/alerts/alert-store";

/**
 * Map a terminal job failure onto AlertStack. Isolated from React and the
 * CollectorService singleton so tests do not load the web host.
 */
export function subscribeJobPermanentFailureAlerts(
  jobs: Pick<JobsPort, "subscribeJobPermanentFailure">,
  alerts: Pick<AlertsApi, "upsert">,
): () => void {
  return jobs.subscribeJobPermanentFailure((failure) => {
    alerts.upsert(`job-failed-${failure.id}`, {
      tone: "danger",
      dismissible: true,
      message: `${failure.type}: ${failure.error}`,
    });
  }).unsubscribe;
}
