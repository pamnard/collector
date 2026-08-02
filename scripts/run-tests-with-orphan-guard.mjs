#!/usr/bin/env node
/**
 * Root `npm test` entry: stamp COLLECTOR_TEST_RUN_ID on the whole tree, run
 * workspace vitests, run scanner unit tests, then assert no leaked processes.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TEST_RUN_ID_ENV } from "./lib/test-run-orphans.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runId = process.env[TEST_RUN_ID_ENV] || randomUUID();
const env = { ...process.env, [TEST_RUN_ID_ENV]: runId };

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const workspaces = [
  "@collector/db",
  "@collector/core",
  "@collector/service",
  "@collector/client",
  "@collector/cli",
  "@collector/mcp",
];

for (const ws of workspaces) {
  run(`vitest ${ws}`, "npm", ["run", "test", "--workspace", ws]);
}

run(
  "test-run orphan scanner unit tests",
  "node",
  ["--test", join(root, "scripts/lib/test-run-orphans.test.mjs")],
);

run(
  "alerts channel guard (#442)",
  "node",
  ["--test", join(root, "scripts/assert-alerts-channel.test.mjs")],
);

run(
  "assert no leaked test-run processes",
  "node",
  [join(root, "scripts/assert-no-test-orphans.mjs")],
);

console.log(`\nOK: full test run clean (${TEST_RUN_ID_ENV}=${runId})`);
