import { useEffect, useState } from "react";
import {
  getVaultIndexSyncStatus,
  subscribeVaultIndexSyncStatus,
  type VaultIndexSyncStatus,
} from "../services/collector-service";

export function useVaultIndexSyncStatus(): VaultIndexSyncStatus {
  const [status, setStatus] = useState<VaultIndexSyncStatus>(() =>
    getVaultIndexSyncStatus(),
  );

  useEffect(() => subscribeVaultIndexSyncStatus(setStatus), []);

  return status;
}
