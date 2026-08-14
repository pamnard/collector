import { useEffect } from "react";
import { getCollectorService } from "../services/collector-client";
import { useAlerts } from "../components/alerts/AlertBusProvider";

/**
 * Permanent job failures → AlertStack only (#630).
 * Must run under AlertBusProvider.
 */
export function useJobPermanentFailureAlerts(): void {
  const service = getCollectorService();
  const alerts = useAlerts();

  useEffect(() => {
    return service.jobs
      .subscribeJobPermanentFailure((failure) => {
        alerts.upsert(`job-failed-${failure.id}`, {
          tone: "danger",
          dismissible: true,
          message: `${failure.type}: ${failure.error}`,
        });
      })
      .unsubscribe;
  }, [alerts, service]);
}
