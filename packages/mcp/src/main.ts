#!/usr/bin/env node
/**
 * `collector-mcp` — stdio MCP server over the living domain host (#556).
 *
 * Usage:
 *   collector-mcp --base-url <url> --data-dir <dir>
 *   collector-mcp --base-url <url> --token <secret>
 *   COLLECTOR_SERVICE_BASE_URL=… COLLECTOR_DATA_DIR=… collector-mcp
 *
 * Host must already be running (READY prints baseUrl). Token is read from
 * dataDir's host token file unless --token / COLLECTOR_SERVICE_TOKEN is set.
 */

import { runCollectorMcp } from "./run.js";

async function main(): Promise<void> {
  const code = await runCollectorMcp(process.argv.slice(2));
  if (code !== 0) {
    process.exit(code);
  }
}

void main();
