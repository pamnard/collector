import { useEffect } from "react";
import { getCollectorService } from "../services/collector-client";
import { useAlerts } from "../components/alerts/AlertBusProvider";
import { subscribeJobPermanentFailureAlerts } from "./job-permanent-failure-alerts";

export { subscribeJobPermanentFailureAlerts };

/**
 * Permanent job failures → AlertStack only.
 * Must run under AlertBusProvider.
 */
export function useJobPermanentFailureAlerts(): void {
  const service = getCollectorService();
  const alerts = useAlerts();

  useEffect(
    () => subscribeJobPermanentFailureAlerts(service.jobs, alerts),
    [alerts, service],
  );
}
