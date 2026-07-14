#!/usr/bin/env bash
# Dev launcher: free Vite port 1420, raise file descriptor limit on Linux.
#
# Usage: npm run tauri:dev
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VITE_PORT=1420
MIN_NOFILE=4096

free_vite_port() {
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${VITE_PORT}/tcp" 2>/dev/null || true
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    local pids=""
    pids="$(lsof -ti:"${VITE_PORT}" 2>/dev/null || true)"
    if [[ -n "${pids}" ]]; then
      # shellcheck disable=SC2086
      kill -9 ${pids} 2>/dev/null || true
    fi
  fi
}

raise_nofile_limit() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    return
  fi
  local current=""
  current="$(ulimit -n)"
  if (( current < MIN_NOFILE )); then
    ulimit -n "${MIN_NOFILE}" 2>/dev/null || {
      echo "warn: could not raise ulimit -n to ${MIN_NOFILE} (current: ${current})" >&2
      echo "warn: if tauri dev panics with 'Too many open files', run: ulimit -n 4096" >&2
    }
  fi
}

free_vite_port
raise_nofile_limit

exec tauri dev --config src-tauri/tauri.conf.dev.json
