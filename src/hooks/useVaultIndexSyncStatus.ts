import { useEffect, useState } from "react";
import type { VaultIndexSyncStatus } from "@collector/api";
import { getCollectorClient } from "../services/collector-client";

export function useVaultIndexSyncStatus(): VaultIndexSyncStatus {
  const client = getCollectorClient();
  const [status, setStatus] = useState<VaultIndexSyncStatus>(() =>
    client.getVaultIndexSyncStatus(),
  );

  useEffect(() => client.subscribeVaultIndexSyncStatus(setStatus), [client]);

  return status;
}
