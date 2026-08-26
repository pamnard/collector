/**
 * Host port→wire coverage (#366).
 */
import { describe, expect, it } from "vitest";
import {
  BOOT_PORT_KEYS,
  CREDENTIALS_PORT_KEYS,
  DASHBOARD_SNAPSHOT_PORT_KEYS,
  EXTRACT_PORT_KEYS,
  FOLDERS_PORT_KEYS,
  INDEX_PORT_KEYS,
  ITEMS_PORT_KEYS,
  JOBS_PORT_KEYS,
  MEDIA_PORT_KEYS,
  SETTINGS_PORT_KEYS,
  SYNC_PLUGINS_PORT_KEYS,
  TAGS_PORT_KEYS,
  TELEGRAM_SYNC_PORT_KEYS,
  VAULTS_PORT_KEYS,
} from "@collector/api";
import { DOMAIN_WIRE_METHODS } from "./domain-methods.js";
import {
  ALL_PORT_METHOD_KEYS,
  assertHostPortWireCoverage,
  CLIENT_ORCHESTRATED_PORT_METHODS,
  HOST_WIRE_PORT_METHODS,
} from "./domain-port-wire.js";

describe("domain port→wire map (#366)", () => {
  it("ALL_PORT_METHOD_KEYS unions every *_PORT_KEYS entry", () => {
    const expected = new Set<string>([
      ...BOOT_PORT_KEYS,
      ...ITEMS_PORT_KEYS,
      ...TAGS_PORT_KEYS,
      ...FOLDERS_PORT_KEYS,
      ...MEDIA_PORT_KEYS,
      ...VAULTS_PORT_KEYS,
      ...INDEX_PORT_KEYS,
      ...JOBS_PORT_KEYS,
      ...SETTINGS_PORT_KEYS,
      ...CREDENTIALS_PORT_KEYS,
      ...SYNC_PLUGINS_PORT_KEYS,
      ...EXTRACT_PORT_KEYS,
      ...TELEGRAM_SYNC_PORT_KEYS,
      ...DASHBOARD_SNAPSHOT_PORT_KEYS,
    ]);
    expect(new Set(ALL_PORT_METHOD_KEYS)).toEqual(expected);
  });

  it("HOST_WIRE_PORT_METHODS excludes client-orchestrated methods", () => {
    for (const method of CLIENT_ORCHESTRATED_PORT_METHODS) {
      expect(HOST_WIRE_PORT_METHODS).not.toContain(method);
    }
  });

  it("DOMAIN_WIRE_METHODS is derived from HOST_WIRE + watcher extras (#330)", () => {
    const catalog = new Set(Object.values(DOMAIN_WIRE_METHODS));
    for (const method of HOST_WIRE_PORT_METHODS) {
      expect(catalog.has(method), method).toBe(true);
    }
    expect(catalog.has("startVaultFilesystemWatcher")).toBe(true);
    expect(catalog.has("stopVaultFilesystemWatcher")).toBe(true);
    expect(catalog.has("isVaultFilesystemWatcherActive")).toBe(true);
    expect(catalog.has("resolveItemHeroMedia")).toBe(true);
    // No handlers → coverage assert is a no-op (catalog is derived).
    expect(() => assertHostPortWireCoverage()).not.toThrow();
  });

  it("client-orchestrated methods are absent from DOMAIN_WIRE_METHODS", () => {
    const catalog = new Set(Object.values(DOMAIN_WIRE_METHODS));
    for (const method of CLIENT_ORCHESTRATED_PORT_METHODS) {
      expect(catalog.has(method), method).toBe(false);
    }
  });

  it("snapshot peek/build stay client-orchestrated; I/O + thumbs are host wire (#552)", () => {
    expect(CLIENT_ORCHESTRATED_PORT_METHODS).toContain(
      "peekMatchingDashboardSnapshot",
    );
    expect(CLIENT_ORCHESTRATED_PORT_METHODS).toContain("buildDashboardSnapshot");
    for (const method of [
      "ensureDashboardSnapshot",
      "persistDashboardSnapshot",
      "clearDashboardSnapshot",
      "resolveItemThumbnailPath",
      "resolveItemThumbnailPaths",
    ] as const) {
      expect(CLIENT_ORCHESTRATED_PORT_METHODS).not.toContain(method);
      expect(HOST_WIRE_PORT_METHODS).toContain(method);
    }
  });
});
