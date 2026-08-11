/**
 * Guard: `@collector/core` UI barrel must not pull Node builtins (#413).
 * Catches Vite "node:crypto externalized for browser" class failures.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "packages/core/src/index.ts");
const coreSrc = join(root, "packages/core/src");

const IMPORT_RE =
  /(?:from\s+|import\s*\()\s*["'](\.[^"']+)["']/g;

function resolveImport(fromFile, spec) {
  const stripped = spec.replace(/\.js$/, "");
  const base = join(dirname(fromFile), stripped);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function collectGraph(startFile) {
  const queue = [startFile];
  const seen = new Set();
  const files = [];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) {
      continue;
    }
    seen.add(file);
    if (!file.startsWith(coreSrc)) {
      continue;
    }
    files.push(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const resolved = resolveImport(file, match[1]);
      if (resolved) {
        queue.push(resolved);
      }
    }
  }
  return files;
}

describe("@collector/core browser entry has no node builtins", () => {
  it("transitive imports from packages/core/src/index.ts avoid node: and Buffer globals for crypto", () => {
    const files = collectGraph(entry);
    assert.ok(files.length > 10, "expected a non-trivial import graph");

    const violations = [];
    for (const file of files) {
      const rel = relative(root, file).split("\\").join("/");
      const source = readFileSync(file, "utf8");
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      if (/from\s+["']node:/.test(code) || /import\s*\(\s*["']node:/.test(code)) {
        violations.push(`${rel}: node: import`);
      }
      // embedding store / vector blob use Buffer — must stay off the UI barrel.
      if (/\bBuffer\b/.test(code) && /embeddings\//.test(rel)) {
        violations.push(`${rel}: Buffer in embeddings reachable from UI barrel`);
      }
    }

    assert.deepEqual(
      violations,
      [],
      `UI @collector/core graph must stay browser-safe:\n${violations.join("\n")}`,
    );
  });
});
