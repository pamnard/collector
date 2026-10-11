import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processEnvForBrowserCookieAccess } from "./browser-cookie-process-env.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("processEnvForBrowserCookieAccess", () => {
  it("keeps an existing XDG_CURRENT_DESKTOP", () => {
    const env = processEnvForBrowserCookieAccess({
      XDG_CURRENT_DESKTOP: "ubuntu:GNOME",
      XDG_RUNTIME_DIR: "/tmp/does-not-matter",
    });
    expect(env.XDG_CURRENT_DESKTOP).toBe("ubuntu:GNOME");
  });

  it.runIf(process.platform === "linux")(
    "sets GNOME when desktop unset but session keyring dir exists",
    () => {
      const runtime = mkdtempSync(join(tmpdir(), "collector-cookie-env-"));
      temps.push(runtime);
      mkdirSync(join(runtime, "keyring"));

      const env = processEnvForBrowserCookieAccess({
        XDG_RUNTIME_DIR: runtime,
      });
      expect(env.XDG_CURRENT_DESKTOP).toBe("GNOME");
    },
  );

  it("does not invent desktop when keyring dir is missing", () => {
    const runtime = mkdtempSync(join(tmpdir(), "collector-cookie-env-"));
    temps.push(runtime);

    const env = processEnvForBrowserCookieAccess({
      XDG_RUNTIME_DIR: runtime,
    });
    expect(env.XDG_CURRENT_DESKTOP).toBeUndefined();
  });
});
