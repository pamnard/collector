import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)));

const NODE_ONLY_BASENAMES = new Set([
  "node.ts",
  "ipc-collector-client-node.ts",
]);

function isExcluded(basename: string): boolean {
  if (basename.endsWith(".test.ts")) return true;
  if (NODE_ONLY_BASENAMES.has(basename)) return true;
  if (basename.startsWith("node-") && basename.endsWith(".ts")) return true;
  return false;
}

function listBrowserEntrySources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...listBrowserEntrySources(abs));
      continue;
    }
    if (!name.endsWith(".ts")) continue;
    if (isExcluded(name)) continue;
    out.push(abs);
  }
  return out;
}

const FORBIDDEN = [
  { name: "Buffer", re: /\bBuffer\b/ },
  { name: "node: import", re: /from\s+["']node:/ },
  { name: "process.cwd|env|platform", re: /\bprocess\.(cwd|env|platform)\b/ },
];

describe("browser-entry must not use Node APIs", () => {
  it("scans non-node client sources for Buffer / node: / process.*", () => {
    const files = listBrowserEntrySources(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const abs of files) {
      const text = readFileSync(abs, "utf8");
      const rel = relative(SRC_ROOT, abs);
      for (const rule of FORBIDDEN) {
        if (rule.re.test(text)) {
          violations.push(`${rel}: ${rule.name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
