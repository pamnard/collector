import { describe, expect, it } from "vitest";
import { resolvePlaywrightBrowsersPath } from "./html-to-pdf.js";

describe("resolvePlaywrightBrowsersPath (#304)", () => {
  it("prefers COLLECTOR_PLAYWRIGHT_BROWSERS when the path exists", () => {
    const resolved = resolvePlaywrightBrowsersPath({
      env: { COLLECTOR_PLAYWRIGHT_BROWSERS: "/tmp/collector-browsers-fixture" },
      argv1: "/tmp/unused/cli.js",
      execPath: "/tmp/unused/node",
      exists: (path) => path === "/tmp/collector-browsers-fixture",
    });
    expect(resolved).toBe("/tmp/collector-browsers-fixture");
  });

  it("uses host ms-playwright next to the running host entry", () => {
    const resolved = resolvePlaywrightBrowsersPath({
      env: {},
      argv1: "/opt/collector-service-host/cli.js",
      execPath: "/opt/collector-service-host/node",
      exists: (path) => path === "/opt/collector-service-host/ms-playwright",
    });
    expect(resolved).toBe("/opt/collector-service-host/ms-playwright");
  });

  it("returns null when no bundled tree exists", () => {
    const resolved = resolvePlaywrightBrowsersPath({
      env: {},
      argv1: "/opt/collector-service-host/cli.js",
      execPath: "/opt/collector-service-host/node",
      exists: () => false,
    });
    expect(resolved).toBeNull();
  });
});
