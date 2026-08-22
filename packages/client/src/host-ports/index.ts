import type {
  DerivedCatchUpStatus,
  IndexPort,
  Subscription,
  VaultIndexSyncStatus,
  VaultPresentationChangedPayload,
} from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";
import { SERVICE_HOST_EVENTS } from "@collector/service/wire";
import type { HostSessionCtx } from "../host-session-ctx.js";

export function createHostIndexPort(ctx: HostSessionCtx): IndexPort {
  const { transport } = ctx;
  return {
    subscribeVaultIndexSyncStatus(
      onUpdate: (status: VaultIndexSyncStatus) => void,
    ): Subscription {
      onUpdate(ctx.cachedSyncStatus);
      const unsubEvent = transport.onEvent(
        SERVICE_HOST_EVENTS.vaultIndexSyncStatus,
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
    subscribeDerivedCatchUpStatus(
      onUpdate: (status: DerivedCatchUpStatus) => void,
    ): Subscription {
      onUpdate(ctx.cachedDerivedCatchUpStatus);
      const unsubEvent = transport.onEvent(
        SERVICE_HOST_EVENTS.derivedCatchUpStatus,
        (payload) => {
          ctx.cachedDerivedCatchUpStatus = payload as DerivedCatchUpStatus;
          onUpdate(ctx.cachedDerivedCatchUpStatus);
        },
      );
      void transport
        .request("getDerivedCatchUpStatus")
        .then((status) => {
          ctx.cachedDerivedCatchUpStatus = status as DerivedCatchUpStatus;
          onUpdate(ctx.cachedDerivedCatchUpStatus);
        })
        .catch(() => {
          // Subscribe still receives push events; seed fetch is best-effort.
        });
      return subscriptionFromTeardown(unsubEvent);
    },
    getDerivedCatchUpStatus(): DerivedCatchUpStatus {
      return ctx.cachedDerivedCatchUpStatus;
    },
    subscribeVaultPresentationChanged(
      onUpdate: (payload: VaultPresentationChangedPayload) => void,
    ): Subscription {
      const unsubEvent = transport.onEvent(
        SERVICE_HOST_EVENTS.vaultPresentationChanged,
        (payload) => {
          onUpdate(payload as VaultPresentationChangedPayload);
        },
      );
      return subscriptionFromTeardown(unsubEvent);
    },
  };
}
