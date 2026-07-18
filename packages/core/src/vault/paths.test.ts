import { describe, expect, it } from "vitest";
import { joinSegments, vaultsRoot } from "./paths.js";

describe("joinSegments", () => {
  it("preserves a leading slash on absolute Unix paths", () => {
    expect(joinSegments("/tmp/smoke/home/.local/share/com.collector.app/collector", "vaults")).toBe(
      "/tmp/smoke/home/.local/share/com.collector.app/collector/vaults",
    );
  });

  it("preserves absolute root when joining bootstrap lock (#181)", () => {
    const vaults = vaultsRoot(
      "/tmp/collector-release-smoke/home/.local/share/com.collector.app/collector",
    );
    expect(joinSegments(vaults, ".bootstrap.lock")).toBe(
      "/tmp/collector-release-smoke/home/.local/share/com.collector.app/collector/vaults/.bootstrap.lock",
    );
  });

  it("preserves Windows drive prefix", () => {
    expect(joinSegments("C:/Users/app/collector", "vaults", ".bootstrap.lock")).toBe(
      "C:/Users/app/collector/vaults/.bootstrap.lock",
    );
  });
});
