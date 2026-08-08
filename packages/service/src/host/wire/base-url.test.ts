import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SERVICE_HOST_BASE_URL_ENV,
  SERVICE_HOST_BASE_URL_FILENAME,
  defaultServiceHostBaseUrlPath,
  readServiceHostBaseUrlFile,
  removeServiceHostBaseUrlFile,
  resolveServiceHostBaseUrl,
  writeServiceHostBaseUrlFile,
} from "./base-url.js";

describe("service host base-url file", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaultServiceHostBaseUrlPath sits under dataDir", () => {
    expect(defaultServiceHostBaseUrlPath("/vault/data")).toBe(
      join("/vault/data", SERVICE_HOST_BASE_URL_FILENAME),
    );
  });

  it("write/read base-url file round-trips and trims", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-host-base-url-"));
    dirs.push(dir);
    const path = defaultServiceHostBaseUrlPath(dir);
    await writeServiceHostBaseUrlFile(path, "http://127.0.0.1:4242");
    expect(readFileSync(path, "utf8")).toBe("http://127.0.0.1:4242\n");
    expect(await readServiceHostBaseUrlFile(path)).toBe(
      "http://127.0.0.1:4242",
    );
  });

  it("removeServiceHostBaseUrlFile is idempotent for missing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-host-base-url-rm-"));
    dirs.push(dir);
    await removeServiceHostBaseUrlFile(defaultServiceHostBaseUrlPath(dir));
  });

  it("resolveServiceHostBaseUrl prefers explicit baseUrl", async () => {
    expect(
      await resolveServiceHostBaseUrl({
        baseUrl: "http://explicit:1",
        dataDir: "/nope",
        env: { [SERVICE_HOST_BASE_URL_ENV]: "http://env:2" },
      }),
    ).toBe("http://explicit:1");
  });

  it("resolveServiceHostBaseUrl prefers env over dataDir file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-host-base-url-env-"));
    dirs.push(dir);
    writeFileSync(
      defaultServiceHostBaseUrlPath(dir),
      "http://from-file:3\n",
      "utf8",
    );
    expect(
      await resolveServiceHostBaseUrl({
        dataDir: dir,
        env: { [SERVICE_HOST_BASE_URL_ENV]: "http://from-env:4" },
      }),
    ).toBe("http://from-env:4");
  });

  it("resolveServiceHostBaseUrl reads dataDir file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-host-base-url-file-"));
    dirs.push(dir);
    writeFileSync(
      defaultServiceHostBaseUrlPath(dir),
      "http://127.0.0.1:5555\n",
      "utf8",
    );
    expect(
      await resolveServiceHostBaseUrl({ dataDir: dir, env: {} }),
    ).toBe("http://127.0.0.1:5555");
  });

  it("resolveServiceHostBaseUrl fails loud when no source", async () => {
    await expect(
      resolveServiceHostBaseUrl({ env: {} }),
    ).rejects.toThrow(/Host endpoint required/i);
  });

  it("resolveServiceHostBaseUrl fails when dataDir file missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-host-base-url-miss-"));
    dirs.push(dir);
    await expect(
      resolveServiceHostBaseUrl({ dataDir: dir, env: {} }),
    ).rejects.toThrow(/missing|not running/i);
  });
});
