#!/usr/bin/env bash
# Build the Collector service sidecar binary into src-tauri/binaries/ for Tauri
# externalBin packaging (#165). Does not start the sidecar (see #166).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TRIPLE="$(rustc --print host-tuple 2>/dev/null || true)"
if [[ -z "$TRIPLE" ]]; then
  TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
fi
if [[ -z "$TRIPLE" ]]; then
  echo "FAIL: could not determine Rust host triple" >&2
  exit 1
fi

EXT=""
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXT=".exe" ;;
esac

mkdir -p src-tauri/binaries

DEST="src-tauri/binaries/collector-service-${TRIPLE}${EXT}"
# tauri-build validates externalBin paths while compiling this package — seed a
# placeholder so `cargo build --bin collector-service` can run, then overwrite.
if [[ ! -f "$DEST" ]]; then
  if [[ -n "$EXT" ]]; then
    # Minimal PE-less stub is fine for the compile-time existence check only.
    printf '' >"$DEST"
  else
    printf '%s\n' '#!/bin/sh' 'echo "collector-service placeholder"' >"$DEST"
    chmod +x "$DEST"
  fi
fi

echo "==> cargo build --release --bin collector-service"
( cd src-tauri && cargo build --release --bin collector-service )

SRC="src-tauri/target/release/collector-service${EXT}"
# Prefer the workspace target dir when CARGO_TARGET_DIR is unset; also check
# common sandbox/alternate target layouts.
if [[ ! -f "$SRC" ]]; then
  ALT="$(ls -1 src-tauri/target/release/collector-service${EXT} 2>/dev/null || true)"
  if [[ -n "${CARGO_TARGET_DIR:-}" && -f "${CARGO_TARGET_DIR}/release/collector-service${EXT}" ]]; then
    SRC="${CARGO_TARGET_DIR}/release/collector-service${EXT}"
  elif [[ -f /tmp/cursor-sandbox-cache/*/cargo-target/release/collector-service${EXT} ]]; then
    SRC="$(ls -1 /tmp/cursor-sandbox-cache/*/cargo-target/release/collector-service${EXT} | head -1)"
  fi
fi
if [[ ! -f "$SRC" ]]; then
  echo "FAIL: missing built sidecar at src-tauri/target/release/collector-service${EXT}" >&2
  find src-tauri/target -name "collector-service${EXT}" 2>/dev/null | head -20 >&2 || true
  exit 1
fi

cp -f "$SRC" "$DEST"
chmod +x "$DEST"
echo "OK: prepared sidecar $DEST"
