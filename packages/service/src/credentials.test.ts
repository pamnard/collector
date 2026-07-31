import { describe, expect, it } from "vitest";
import { isAbsolute } from "node:path";
import { createRequire } from "node:module";
import {
  CREDENTIALS_KEYCHAIN_SERVICE,
  createCredentialsNativeRequire,
  createCredentialsService,
  createMemoryKeychainBackend,
  createOsKeychainBackend,
  createUnavailableKeychainBackend,
  credentialAccount,
  credentialsNativeRequireFilenames,
} from "./credentials.js";

describe("credentials (#30)", () => {
  it("builds keychain account as pluginId.key", () => {
    expect(CREDENTIALS_KEYCHAIN_SERVICE).toBe("com.collector.app");
    expect(
      credentialAccount({ pluginId: "telegram", key: "bot_token" }),
    ).toBe("telegram.bot_token");
  });

  it("native require filenames are absolute (packaged-host createRequire)", () => {
    const filenames = credentialsNativeRequireFilenames();
    expect(filenames.length).toBeGreaterThan(0);
    for (const filename of filenames) {
      expect(isAbsolute(filename), filename).toBe(true);
    }
    // Models the release symptom: createRequire(undefined) throws Node's message.
    expect(() => createRequire(undefined as unknown as string)).toThrow(
      /filename/,
    );
  });

  it("createCredentialsNativeRequire resolves @napi-rs/keyring", () => {
    const req = createCredentialsNativeRequire();
    expect(req.resolve("@napi-rs/keyring")).toMatch(/@napi-rs[/\\]keyring/);
  });

  it("rejects empty pluginId/key/secret", async () => {
    const service = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    await expect(
      service.setCredential({ pluginId: "", key: "bot_token", secret: "x" }),
    ).rejects.toThrow(/pluginId/);
    await expect(
      service.setCredential({
        pluginId: "telegram",
        key: "",
        secret: "x",
      }),
    ).rejects.toThrow(/key/);
    await expect(
      service.setCredential({
        pluginId: "telegram",
        key: "bot_token",
        secret: "",
      }),
    ).rejects.toThrow(/secret/);
  });

  it("set/get/has/delete round-trip on memory backend", async () => {
    const service = createCredentialsService({
      backend: createMemoryKeychainBackend(),
    });
    const ref = { pluginId: "telegram", key: "bot_token" };

    await expect(service.getCredentialsAvailability()).resolves.toEqual({
      available: true,
    });
    await expect(service.hasCredential(ref)).resolves.toBe(false);
    await expect(service.getCredential(ref)).resolves.toBeNull();

    await service.setCredential({ ...ref, secret: "tok-abc" });
    await expect(service.hasCredential(ref)).resolves.toBe(true);
    await expect(service.getCredential(ref)).resolves.toBe("tok-abc");

    await service.deleteCredential(ref);
    await expect(service.hasCredential(ref)).resolves.toBe(false);
    await expect(service.getCredential(ref)).resolves.toBeNull();
  });

  it("unavailable backend reports reason and fails ops", async () => {
    const service = createCredentialsService({
      backend: createUnavailableKeychainBackend("no secret service"),
    });
    await expect(service.getCredentialsAvailability()).resolves.toEqual({
      available: false,
      reason: "no secret service",
    });
    await expect(
      service.setCredential({
        pluginId: "telegram",
        key: "bot_token",
        secret: "x",
      }),
    ).rejects.toThrow(/unavailable/);
  });

  it("set/get/delete against OS keychain when available", async () => {
    const backend = createOsKeychainBackend();
    const avail = backend.availability();
    if (!avail.available) {
      expect(avail.reason).toBeTruthy();
      return;
    }
    const service = createCredentialsService({ backend });
    const ref = { pluginId: "collector", key: "issue30_probe" };
    await service.setCredential({ ...ref, secret: "probe-secret-30" });
    await expect(service.getCredential(ref)).resolves.toBe("probe-secret-30");
    await expect(service.hasCredential(ref)).resolves.toBe(true);
    await service.deleteCredential(ref);
    await expect(service.getCredential(ref)).resolves.toBeNull();
    expect(credentialAccount(ref)).toBe("collector.issue30_probe");
  });
});
