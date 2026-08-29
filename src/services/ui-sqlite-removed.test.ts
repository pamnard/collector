/**
 * UI must not expose local/sqlite DB adapters (#332).
 * Export + import-graph contract on public modules — not filesystem
 * «file missing» checks or a single `not.toHaveProperty` name.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer, type ModuleNode, type ViteDevServer } from "vite";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Catches LocalAdapter / sqlite / createLocal* aliases under any export name. */
const FORBIDDEN_EXPORT =
  /(?:Local(?:Adapter|Collector)|Sqlite|BetterSqlite|createLocal|openLocalDb|NodeFileSystemAdapter)/i;

/**
 * Retired UI local adapter modules + Node-only FS / sqlite drivers.
 * Scoped so `@collector/service` and `mock-collector-service` stay allowed.
 */
const FORBIDDEN_MODULE_ID =
  /(?:[\\/]src[\\/]services[\\/](?:local-adapter|collector-service)(?:\.tsx?)?(?:$|\?)|better-sqlite|node-fs-adapter)/i;

const REQUIRED_COLLECTOR_CLIENT = [
  "getCollectorService",
  "setCollectorService",
  "getUiSession",
  "setUiSession",
  "installDevMockCollectorService",
  "createDevMockCollectorService",
  "createDevMockUiSession",
] as const;

function forbiddenExportNames(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).filter((name) => FORBIDDEN_EXPORT.test(name));
}

function collectModuleIds(entry: ModuleNode): string[] {
  const seen = new Set<string>();
  const stack: ModuleNode[] = [entry];
  while (stack.length > 0) {
    const mod = stack.pop()!;
    const id = mod.id ?? mod.url;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const child of mod.importedModules) {
      stack.push(child);
    }
  }
  return [...seen];
}

describe("UI collector surface has no local/sqlite adapters (#332)", () => {
  let server: ViteDevServer;

  before(async () => {
    // middlewareMode — do not bind :1420; configFile false — no vault plugin
    server = await createServer({
      configFile: false,
      root,
      logLevel: "error",
      appType: "custom",
      server: { middlewareMode: true },
      resolve: {
        conditions: ["@collector/source"],
        alias: {
          "@": path.join(root, "src"),
        },
      },
    });
  });

  after(async () => {
    await server.close();
  });

  it("public modules: forbidden exports absent; host client path present; import graph clean", async () => {
    const collectorClient = (await server.ssrLoadModule(
      "/src/services/collector-client.ts",
    )) as Record<string, unknown>;
    const uiSession = (await server.ssrLoadModule(
      "/src/services/ui-session.ts",
    )) as Record<string, unknown>;
    const httpAdapter = (await server.ssrLoadModule(
      "/src/services/http-adapter.ts",
    )) as Record<string, unknown>;
    const hostClient = (await server.ssrLoadModule(
      "/packages/client/src/index.ts",
    )) as Record<string, unknown>;

    assert.deepEqual(
      forbiddenExportNames(collectorClient),
      [],
      "collector-client leaked forbidden export names",
    );
    assert.deepEqual(
      forbiddenExportNames(uiSession),
      [],
      "ui-session leaked forbidden export names",
    );
    assert.deepEqual(
      forbiddenExportNames(httpAdapter),
      [],
      "http-adapter leaked forbidden export names",
    );
    assert.deepEqual(
      forbiddenExportNames(hostClient),
      [],
      "@collector/client leaked forbidden export names",
    );

    for (const name of REQUIRED_COLLECTOR_CLIENT) {
      assert.equal(
        typeof collectorClient[name],
        "function",
        `collector-client missing supported export ${name}`,
      );
    }
    assert.equal(typeof uiSession.getUiSession, "function");
    assert.equal(typeof uiSession.setUiSession, "function");
    assert.equal(
      typeof httpAdapter.createHttpUiCutover,
      "function",
      "supported host cutover path missing on http-adapter",
    );
    assert.equal(typeof hostClient.createCollectorHostService, "function");
    assert.equal(typeof hostClient.createHttpHostTransport, "function");
    assert.equal(typeof hostClient.createHostThumbnailsPort, "function");
    assert.equal(typeof hostClient.createHostDashboardSnapshotPort, "function");

    for (const url of [
      "/src/services/collector-client.ts",
      "/src/services/ui-session.ts",
      "/src/services/http-adapter.ts",
    ]) {
      const node = await server.moduleGraph.ensureEntryFromUrl(url, true);
      assert.ok(node, `module graph entry missing for ${url}`);
      const hits = collectModuleIds(node).filter((id) =>
        FORBIDDEN_MODULE_ID.test(id),
      );
      assert.deepEqual(
        hits,
        [],
        `forbidden modules reachable from ${url}: ${hits.join(", ")}`,
      );
    }
  });
});
