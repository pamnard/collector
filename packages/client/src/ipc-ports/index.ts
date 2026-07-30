import type {
  IndexPort,
  Subscription,
  VaultIndexSyncStatus,
} from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";
import { SERVICE_IPC_EVENTS } from "@collector/service/ipc";
import type { IpcSessionCtx } from "../ipc-session-ctx.js";

export function createIpcIndexPort(ctx: IpcSessionCtx): IndexPort {
  const { transport } = ctx;
  return {
    subscribeVaultIndexSyncStatus(
      onUpdate: (status: VaultIndexSyncStatus) => void,
    ): Subscription {
      onUpdate(ctx.cachedSyncStatus);
      const unsubEvent = transport.onEvent(
        SERVICE_IPC_EVENTS.vaultIndexSyncStatus,
        (payload) => {
          ctx.cachedSyncStatus = payload as VaultIndexSyncStatus;
          onUpdate(ctx.cachedSyncStatus);
        },
      );
      void transport
        .request("getVaultIndexSyncStatus")
        .then((status) => {
          ctx.cachedSyncStatus = status as VaultIndexSyncStatus;
          onUpdate(ctx.cachedSyncStatus);
        })
        .catch(() => {
          // Subscribe still receives push events; seed fetch is best-effort.
        });
      return subscriptionFromTeardown(unsubEvent);
    },
    getVaultIndexSyncStatus(): VaultIndexSyncStatus {
      return ctx.cachedSyncStatus;
    },
  };
}
