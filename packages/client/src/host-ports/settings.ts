import type { SettingsPort, Subscription } from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";
import type { AppSettings } from "@collector/shared";
import { SERVICE_HOST_EVENTS } from "@collector/service/wire";
import type { HostSessionCtx } from "../host-session-ctx.js";

export function createHostSettingsPort(ctx: HostSessionCtx): SettingsPort {
  const { transport } = ctx;
  return {
    ensureAppSettings: async (): Promise<AppSettings> => {
      ctx.settingsCache = (await transport.request(
        "ensureAppSettings",
      )) as AppSettings;
      return ctx.settingsCache;
    },
    getAppSettingsSync(): AppSettings | null {
      return ctx.settingsCache;
    },
    updateAppSettings: async (
      patch: Partial<AppSettings>,
    ): Promise<AppSettings> => {
      ctx.settingsCache = (await transport.request("updateAppSettings", {
        patch,
      })) as AppSettings;
      return ctx.settingsCache;
    },
    subscribeAppSettings(
      onUpdate: (settings: AppSettings) => void,
    ): Subscription {
      if (ctx.settingsCache) {
        onUpdate(ctx.settingsCache);
      }
      let sawPush = false;
      const unsubEvent = transport.onEvent(
        SERVICE_HOST_EVENTS.appSettings,
        (payload) => {
          sawPush = true;
          ctx.settingsCache = payload as AppSettings;
          onUpdate(ctx.settingsCache);
        },
      );
      void transport
        .request("ensureAppSettings")
        .then((settings) => {
          // Do not clobber a newer host push that arrived during seed (#329).
          if (sawPush) {
            return;
          }
          ctx.settingsCache = settings as AppSettings;
          onUpdate(ctx.settingsCache);
        })
        .catch(() => {
          // Subscribe still receives push events; seed fetch is best-effort.
        });
      return subscriptionFromTeardown(unsubEvent);
    },
    getAppConfigDirectory: async (): Promise<string> =>
      transport.request("getAppConfigDirectory") as Promise<string>,
  };
}
