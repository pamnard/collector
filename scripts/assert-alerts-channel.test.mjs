/**
 * Guard: page-level error strips and extra AlertStack hosts are banned (#442).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(root, "src");

const STRIP_ALLOWLIST = new Set([
  "components/alerts/Alert.tsx",
  "components/startup/StartupErrorScreen.tsx",
]);

const ALERT_STACK_ALLOWLIST = new Set([
  "components/alerts/AlertStack.tsx",
  "components/alerts/AlertHost.tsx",
]);

function walkTsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      walkTsFiles(path, out);
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(path);
    }
  }
  return out;
}

function hasStripCombo(source, borderClass, bgClass) {
  return source.includes(borderClass) && source.includes(bgClass);
}

describe("alerts channel guard (#442)", () => {
  const files = walkTsFiles(srcRoot);

  it("bans inline red/amber error strip class combos outside allowlist", () => {
    const violations = [];
    for (const file of files) {
      const rel = relative(srcRoot, file).split("\\").join("/");
      if (STRIP_ALLOWLIST.has(rel)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (
        hasStripCombo(source, "border-red-500/30", "bg-red-500/10") ||
        hasStripCombo(source, "border-amber-500/30", "bg-amber-500/10")
      ) {
        violations.push(rel);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `inline error/warn strips forbidden; use AlertStack bus. offenders: ${violations.join(", ")}`,
    );
  });

  it("allows AlertStack import/use only in AlertHost (+ definition)", () => {
    const violations = [];
    const importRe =
      /import\s*\{[^}]*\bAlertStack\b[^}]*\}\s*from\s*["'][^"']*AlertStack["']/;
    const jsxRe = /<\s*AlertStack\b/;
    for (const file of files) {
      const rel = relative(srcRoot, file).split("\\").join("/");
      if (ALERT_STACK_ALLOWLIST.has(rel)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (importRe.test(source) || jsxRe.test(source)) {
        violations.push(rel);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `AlertStack may only be used by AlertHost. offenders: ${violations.join(", ")}`,
    );
  });
});
