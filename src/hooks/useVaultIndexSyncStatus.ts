import { useEffect, useState } from "react";
import type { VaultIndexSyncStatus } from "@collector/api";
import { getCollectorService } from "../services/collector-client";

export function useVaultIndexSyncStatus(): VaultIndexSyncStatus {
  const service = getCollectorService();
  const [status, setStatus] = useState<VaultIndexSyncStatus>(() =>
    service.index.getVaultIndexSyncStatus(),
  );

  useEffect(() => service.index.subscribeVaultIndexSyncStatus(setStatus), [service]);

  return status;
}
