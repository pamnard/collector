import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultServiceIpcTokenPath,
  extractAuthToken,
  generateServiceIpcToken,
  readServiceIpcTokenFile,
  resolveServiceIpcToken,
  siblingServiceIpcTokenPath,
  tokensEqual,
  writeServiceIpcTokenFile,
} from "./auth.js";

describe("service IPC auth helpers", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaultServiceIpcTokenPath sits under dataDir", () => {
    expect(defaultServiceIpcTokenPath("/vault/data")).toBe(
      join("/vault/data", "collector-service.ipc-token"),
    );
  });

  it("sibling token path only for collector-service.sock", () => {
    expect(
      siblingServiceIpcTokenPath(join("/vault/data", "collector-service.sock")),
    ).toBe(join("/vault/data", "collector-service.ipc-token"));
    expect(siblingServiceIpcTokenPath(join("/vault/data", "other.sock"))).toBe(
      null,
    );
  });

  it("generateServiceIpcToken returns non-empty distinct values", () => {
    const a = generateServiceIpcToken();
    const b = generateServiceIpcToken();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });

  it("write/read token file round-trips and trims", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-ipc-token-"));
    dirs.push(dir);
    const path = defaultServiceIpcTokenPath(dir);
    await writeServiceIpcTokenFile(path, "secret-token-value");
    expect(readFileSync(path, "utf8")).toBe("secret-token-value\n");
    expect(await readServiceIpcTokenFile(path)).toBe("secret-token-value");
  });

  it("tokensEqual is length-safe", () => {
    expect(tokensEqual("abc", "abc")).toBe(true);
    expect(tokensEqual("abc", "abd")).toBe(false);
    expect(tokensEqual("abc", "ab")).toBe(false);
  });

  it("extractAuthToken reads params.token", () => {
    expect(extractAuthToken({ token: "x" })).toBe("x");
    expect(extractAuthToken({})).toBe(null);
    expect(extractAuthToken(null)).toBe(null);
  });

  it("resolveServiceIpcToken prefers explicit token", async () => {
    expect(
      await resolveServiceIpcToken("/ignored", {
        token: "explicit",
        dataDir: "/nope",
        env: { COLLECTOR_IPC_TOKEN: "env" },
      }),
    ).toBe("explicit");
  });

  it("resolveServiceIpcToken reads dataDir file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-ipc-resolve-"));
    dirs.push(dir);
    const path = defaultServiceIpcTokenPath(dir);
    writeFileSync(path, "from-file\n", "utf8");
    expect(
      await resolveServiceIpcToken(join(dir, "collector-service.sock"), {
        dataDir: dir,
        env: {},
      }),
    ).toBe("from-file");
  });

  it("resolveServiceIpcToken reads sibling sock token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-ipc-sib-"));
    dirs.push(dir);
    const sock = join(dir, "collector-service.sock");
    writeFileSync(defaultServiceIpcTokenPath(dir), "sib\n", "utf8");
    expect(await resolveServiceIpcToken(sock, { env: {} })).toBe("sib");
  });
});
