import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { listItemRelativePaths } from "./scan.js";

type VaultWalkCase = {
  name: string;
  files: Record<string, string>;
  dirs: string[];
  expectedItems: string[];
};

const fixturesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../shared/fixtures/vault-walk-cases.json",
);

describe("vault walk shared fixtures (#390)", () => {
  let dataDir = "";
  const adapter = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    dataDir = "";
  });

  it("matches expected item lists from shared fixtures", async () => {
    const cases = JSON.parse(
      await readFile(fixturesPath, "utf8"),
    ) as VaultWalkCase[];
    expect(cases.length).toBeGreaterThan(0);

    for (const walkCase of cases) {
      dataDir = await mkdtemp(join(tmpdir(), `collector-walk-${walkCase.name}-`));
      for (const rel of walkCase.dirs) {
        await mkdir(join(dataDir, ...rel.split("/")), { recursive: true });
      }
      for (const [rel, content] of Object.entries(walkCase.files)) {
        const abs = join(dataDir, ...rel.split("/"));
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content);
      }

      const items = await listItemRelativePaths(adapter, dataDir);
      items.sort();
      const expected = [...walkCase.expectedItems].sort();
      expect(items, walkCase.name).toEqual(expected);

      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });
});
