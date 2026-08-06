#!/usr/bin/env bash
# Local pre-release gate without Tauri (#555).
#
# Usage:
#   npm run verify:release
#   ./scripts/verify-release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

step() {
  echo ""
  echo "==> $*"
}

step "typecheck"
npm run typecheck

step "unit tests"
npm test

step "startup index smoke"
npm run test:startup

step "service host health smoke"
npm run test:service-host

step "service host lifecycle smoke"
npm run test:service-host-lifecycle

step "service IPC health smoke"
npm run test:service-ipc

step "large empty-index smoke"
npm run test:large-empty-index

step "frontend + packages build"
npm run build

step "prepare release bundle (host + UI)"
bash scripts/prepare-release-bundle.sh

RELEASE_ROOT="$ROOT/dist/collector-release"
HOST_RES="$RELEASE_ROOT/collector-service-host"
UI_DIR="$RELEASE_ROOT/ui"
[[ -f "$HOST_RES/cli.js" ]] || fail "packaged host missing cli.js at $HOST_RES"
[[ -f "$HOST_RES/node" || -f "$HOST_RES/node.exe" ]] || fail "packaged host missing bundled node"
[[ -d "$HOST_RES/node_modules/better-sqlite3" ]] || fail "packaged host missing better-sqlite3"
[[ -d "$HOST_RES/node_modules/sharp" ]] || fail "packaged host missing sharp"
[[ -f "$HOST_RES/bin/ffmpeg" || -f "$HOST_RES/bin/ffmpeg.exe" ]] || fail "packaged host missing ffmpeg"
[[ -f "$HOST_RES/collector-cli.js" ]] || fail "packaged host missing collector-cli.js"
[[ -f "$HOST_RES/collector-mcp.js" ]] || fail "packaged host missing collector-mcp.js"
[[ -f "$RELEASE_ROOT/collector" ]] || fail "release launcher missing"
[[ -f "$UI_DIR/index.html" ]] || fail "release UI missing index.html"

HOST_NODE="$HOST_RES/node"
[[ -f "$HOST_RES/node.exe" ]] && HOST_NODE="$HOST_RES/node.exe"
cli_help_out="$("$HOST_NODE" "$HOST_RES/collector-cli.js" 2>&1 || true)"
echo "$cli_help_out" | grep -qE 'Usage: collector-cli|Service endpoint required' \
  || fail "collector-cli.js smoke failed: $cli_help_out"
mcp_help_out="$("$HOST_NODE" "$HOST_RES/collector-mcp.js" 2>&1 || true)"
echo "$mcp_help_out" | grep -qE 'Host endpoint required|Service endpoint required|base-url|data-dir|COLLECTOR_SERVICE' \
  || fail "collector-mcp.js smoke failed: $mcp_help_out"

step "packaged host + UI HTTP smoke"
node scripts/packaged-release-bundle-smoke.mjs

step "OK: verify:release passed (host+UI archive path, no Tauri)"
