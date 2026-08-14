import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultServiceHostTokenPath,
  generateServiceHostToken,
  readServiceHostTokenFile,
  resolveServiceHostToken,
  tokensEqual,
  writeServiceHostTokenFile,
} from "./auth.js";

describe("service host auth helpers", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaultServiceHostTokenPath sits under dataDir", () => {
    expect(defaultServiceHostTokenPath("/vault/data")).toBe(
      join("/vault/data", "collector-service.host-token"),
    );
  });

  it("generateServiceHostToken returns non-empty distinct values", () => {
    const a = generateServiceHostToken();
    const b = generateServiceHostToken();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });

  it("write/read token file round-trips and trims", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-host-token-"));
    dirs.push(dir);
    const path = defaultServiceHostTokenPath(dir);
    await writeServiceHostTokenFile(path, "secret-token-value");
    expect(readFileSync(path, "utf8")).toBe("secret-token-value\n");
    expect(await readServiceHostTokenFile(path)).toBe("secret-token-value");
  });

  it("tokensEqual is length-safe", () => {
    expect(tokensEqual("abc", "abc")).toBe(true);
    expect(tokensEqual("abc", "abd")).toBe(false);
    expect(tokensEqual("abc", "ab")).toBe(false);
  });

  it("resolveServiceHostToken prefers explicit token", async () => {
    expect(
      await resolveServiceHostToken({
        token: "explicit",
        dataDir: "/nope",
        env: { COLLECTOR_HOST_TOKEN: "env" },
      }),
    ).toBe("explicit");
  });

  it("resolveServiceHostToken reads dataDir file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-host-resolve-"));
    dirs.push(dir);
    const path = defaultServiceHostTokenPath(dir);
    writeFileSync(path, "from-file\n", "utf8");
    expect(
      await resolveServiceHostToken({
        dataDir: dir,
        env: {},
      }),
    ).toBe("from-file");
  });
});
