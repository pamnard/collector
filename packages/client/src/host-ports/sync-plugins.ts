import type { SyncNowResult, SyncPluginsPort } from "@collector/api";
import type { HostSessionCtx } from "../host-session-ctx.js";

export function createHostSyncPluginsPort(
  ctx: HostSessionCtx,
): SyncPluginsPort {
  const { transport } = ctx;
  return {
    syncNow: async (pluginId) =>
      transport.request("syncNow", { pluginId }) as Promise<SyncNowResult>,
  };
}
