import { useEffect, useState } from "react";
import type { DerivedCatchUpStatus } from "@collector/api";
import { getCollectorService } from "../services/collector-client";

export function useDerivedCatchUpStatus(): DerivedCatchUpStatus {
  const service = getCollectorService();
  const [status, setStatus] = useState<DerivedCatchUpStatus>(() =>
    service.index.getDerivedCatchUpStatus(),
  );

  useEffect(
    () => service.index.subscribeDerivedCatchUpStatus(setStatus),
    [service],
  );

  return status;
}
