import { describe, expect, it } from "vitest";
import { accessSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("LocalAdapter retired (#332)", () => {
  it("does not export createLocalCollectorService from collector-client", async () => {
    const client = await import("./collector-client");
    expect(client).not.toHaveProperty("createLocalCollectorService");
    expect(client).toHaveProperty("createDevMockCollectorService");
    expect(client).toHaveProperty("installDevMockCollectorService");
  });

  it("collector-service.ts and local-adapter.ts are gone from the tree", () => {
    for (const name of ["collector-service.ts", "local-adapter.ts"]) {
      let exists = true;
      try {
        accessSync(join(here, name));
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    }
  });
});
