import type { SyncNowResult, SyncPluginsPort } from "@collector/api";
import type { IpcSessionCtx } from "../ipc-session-ctx.js";

export function createIpcSyncPluginsPort(
  ctx: IpcSessionCtx,
): SyncPluginsPort {
  const { transport } = ctx;
  return {
    syncNow: async (pluginId) =>
      transport.request("syncNow", { pluginId }) as Promise<SyncNowResult>,
  };
}
