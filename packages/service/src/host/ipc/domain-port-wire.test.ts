/**
 * Host port→wire coverage (#366).
 */
import { describe, expect, it } from "vitest";
import {
  BOOT_PORT_KEYS,
  CREDENTIALS_PORT_KEYS,
  DASHBOARD_SNAPSHOT_PORT_KEYS,
  FOLDERS_PORT_KEYS,
  INDEX_PORT_KEYS,
  ITEMS_PORT_KEYS,
  MEDIA_PORT_KEYS,
  SETTINGS_PORT_KEYS,
  TAGS_PORT_KEYS,
  VAULTS_PORT_KEYS,
} from "@collector/api";
import { DOMAIN_IPC_METHODS } from "./domain-methods.js";
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
      ...SETTINGS_PORT_KEYS,
      ...CREDENTIALS_PORT_KEYS,
      ...DASHBOARD_SNAPSHOT_PORT_KEYS,
    ]);
    expect(new Set(ALL_PORT_METHOD_KEYS)).toEqual(expected);
  });

  it("HOST_WIRE_PORT_METHODS excludes client-orchestrated methods", () => {
    for (const method of CLIENT_ORCHESTRATED_PORT_METHODS) {
      expect(HOST_WIRE_PORT_METHODS).not.toContain(method);
    }
  });

  it("DOMAIN_IPC_METHODS is derived from HOST_WIRE + watcher extras (#330)", () => {
    const catalog = new Set(Object.values(DOMAIN_IPC_METHODS));
    for (const method of HOST_WIRE_PORT_METHODS) {
      expect(catalog.has(method), method).toBe(true);
    }
    expect(catalog.has("startVaultFilesystemWatcher")).toBe(true);
    expect(catalog.has("stopVaultFilesystemWatcher")).toBe(true);
    expect(catalog.has("isVaultFilesystemWatcherActive")).toBe(true);
    // No handlers → coverage assert is a no-op (catalog is derived).
    expect(() => assertHostPortWireCoverage()).not.toThrow();
  });

  it("client-orchestrated methods are absent from DOMAIN_IPC_METHODS", () => {
    const catalog = new Set(Object.values(DOMAIN_IPC_METHODS));
    for (const method of CLIENT_ORCHESTRATED_PORT_METHODS) {
      expect(catalog.has(method), method).toBe(false);
    }
  });

  it("snapshot and thumbnail abs paths are client-orchestrated (#368)", () => {
    for (const method of DASHBOARD_SNAPSHOT_PORT_KEYS) {
      expect(CLIENT_ORCHESTRATED_PORT_METHODS).toContain(method);
      expect(HOST_WIRE_PORT_METHODS).not.toContain(method);
    }
    expect(CLIENT_ORCHESTRATED_PORT_METHODS).toContain(
      "resolveItemThumbnailPath",
    );
    expect(CLIENT_ORCHESTRATED_PORT_METHODS).toContain(
      "resolveItemThumbnailPaths",
    );
    expect(HOST_WIRE_PORT_METHODS).not.toContain("resolveItemThumbnailPath");
    expect(HOST_WIRE_PORT_METHODS).not.toContain("resolveItemThumbnailPaths");
  });
});
