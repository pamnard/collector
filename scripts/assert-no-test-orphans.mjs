#!/usr/bin/env node
/**
 * Fail if any process from this test run is still alive.
 *
 * Requires COLLECTOR_TEST_RUN_ID in the environment (set by the test runner wrapper).
 */
import {
  TEST_RUN_ID_ENV,
  listLeakedTestRunProcesses,
} from "./lib/test-run-orphans.mjs";

const runId = process.env[TEST_RUN_ID_ENV];
if (!runId) {
  console.error(`FAIL: ${TEST_RUN_ID_ENV} is not set`);
  process.exit(2);
}

const leaks = listLeakedTestRunProcesses(runId);
if (leaks.length === 0) {
  console.log(`OK: no leaked processes for ${TEST_RUN_ID_ENV}=${runId}`);
  process.exit(0);
}

console.error(
  `FAIL: ${leaks.length} process(es) still carry ${TEST_RUN_ID_ENV}=${runId} after tests:`,
);
for (const leak of leaks) {
  console.error(`  pid=${leak.pid} cmdline=${leak.cmdline || "(empty)"}`);
}
process.exit(1);
