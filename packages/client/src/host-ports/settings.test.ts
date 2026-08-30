/**
 * createHostSettingsPort against a real service host (#923).
 * Cache / update / subscribe over HTTP; sawPush race is client-local (#329).
 */

import {
  SETTINGS_PORT_KEYS,
  type SettingsPort,
} from "@collector/api";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from "@collector/shared";
import {
  SERVICE_HOST_EVENTS,
  type HostWireClient,
} from "@collector/service/wire";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveServiceHostToken,
  startServiceHost,
} from "@collector/service/host";
import { createHttpHostTransport } from "../http-host-transport.js";
import { createHostSessionCtx } from "../host-session-ctx.js";
import { createHostSettingsPort } from "./settings.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDataDir(prefix: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dataDir);
  return dataDir;
}

function mockTransport(parts: {
  request: HostWireClient["request"];
  onEvent?: HostWireClient["onEvent"];
}): HostWireClient {
  return {
    request: parts.request,
    ping: vi.fn(async () => ({ ok: true as const, pong: true as const })),
    health: vi.fn(async () => ({
      ok: true,
      status: "healthy" as const,
      open: true,
      healthy: true,
    })),
    onEvent: parts.onEvent ?? vi.fn(() => () => {}),
    close: vi.fn(async () => {}),
  };
}

describe("createHostSettingsPort (#923)", () => {
  it("SETTINGS_PORT_KEYS are all functions on the port", () => {
    const port = createHostSettingsPort(
      createHostSessionCtx(
        mockTransport({
          request: vi.fn(async () => {
            throw new Error("unused");
          }),
        }),
      ),
    );
    for (const key of SETTINGS_PORT_KEYS) {
      expect(typeof port[key as keyof SettingsPort], key).toBe("function");
    }
  });

  it("ensure/update/sync-cache/subscribe reflect host settings over wire", async () => {
    const dataDir = tempDataDir("collector-settings-port-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: await resolveServiceHostToken({ dataDir }),
      });
      try {
        const ctx = createHostSessionCtx(transport);
        const port = createHostSettingsPort(ctx);

        expect(port.getAppSettingsSync()).toBeNull();

        const ensured = await port.ensureAppSettings();
        expect(ensured).toBeTruthy();
        expect(port.getAppSettingsSync()).toEqual(ensured);

        const nextTheme = ensured.theme === "dark" ? "light" : "dark";
        const updated = await port.updateAppSettings({ theme: nextTheme });
        expect(updated.theme).toBe(nextTheme);
        expect(port.getAppSettingsSync()?.theme).toBe(nextTheme);

        const again = await port.ensureAppSettings();
        expect(again.theme).toBe(nextTheme);

        const configDir = await port.getAppConfigDirectory();
        expect(configDir).toContain(dataDir);

        const seen: AppSettings[] = [];
        const sub = port.subscribeAppSettings((next) => {
          seen.push(next);
        });
        await vi.waitFor(() => {
          expect(seen.length).toBeGreaterThanOrEqual(1);
          expect(seen[0]!.theme).toBe(nextTheme);
        });

        const flipped = nextTheme === "dark" ? "light" : "dark";
        const patched = await port.updateAppSettings({ theme: flipped });
        await vi.waitFor(() => {
          expect(seen.some((row) => row.theme === patched.theme)).toBe(true);
        });
        expect(port.getAppSettingsSync()?.theme).toBe(flipped);
        sub.unsubscribe();
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });

  it("seed ensure does not clobber a newer appSettings push (#329)", async () => {
    let resolveSeed!: (settings: AppSettings) => void;
    const seed = new Promise<AppSettings>((resolve) => {
      resolveSeed = resolve;
    });

    const stale: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      theme: "light",
    };
    const fresh: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      theme: "dark",
    };

    let pushHandler: ((payload: unknown) => void) | undefined;
    const transport = mockTransport({
      request: vi.fn(async (method: string) => {
        if (method === "ensureAppSettings") {
          return seed;
        }
        throw new Error(`unexpected ${method}`);
      }),
      onEvent: vi.fn((event, handler) => {
        if (event === SERVICE_HOST_EVENTS.appSettings) {
          pushHandler = handler;
        }
        return () => {};
      }),
    });

    const ctx = createHostSessionCtx(transport);
    const port = createHostSettingsPort(ctx);
    const updates: AppSettings[] = [];
    const sub = port.subscribeAppSettings((next) => {
      updates.push(next);
    });

    expect(pushHandler).toBeTypeOf("function");
    pushHandler!(fresh);
    expect(ctx.settingsCache?.theme).toBe("dark");
    expect(updates.at(-1)?.theme).toBe("dark");

    resolveSeed(stale);
    // await seed: fulfillment handlers (including subscribe's .then) run before this continues.
    await seed;
    expect(ctx.settingsCache?.theme).toBe("dark");
    expect(updates.filter((row) => row.theme === "light")).toHaveLength(0);
    sub.unsubscribe();
  });
});
