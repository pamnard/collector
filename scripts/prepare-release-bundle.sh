#!/usr/bin/env bash
# Build release archive: packaged host + static UI (#555).
# Output under dist/collector-release/:
#   collector-service-host/  — bundled Node domain host
#   ui/                      — vite build
#   collector / collector.cmd — launcher
#   collector-<ver>-<os>-<arch>.tar.gz (or .zip on Windows)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
RELEASE_ROOT="$ROOT/dist/collector-release"
HOST_OUT="$RELEASE_ROOT/collector-service-host"
UI_OUT="$RELEASE_ROOT/ui"

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux) OS_LABEL="linux" ;;
  Darwin) OS_LABEL="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) OS_LABEL="windows" ;;
  *) echo "FAIL: unsupported OS $OS" >&2; exit 1 ;;
esac
case "$ARCH" in
  x86_64|amd64) ARCH_LABEL="x64" ;;
  aarch64|arm64) ARCH_LABEL="arm64" ;;
  *) echo "FAIL: unsupported arch $ARCH" >&2; exit 1 ;;
esac

echo "==> clean $RELEASE_ROOT"
rm -rf "$RELEASE_ROOT"
mkdir -p "$RELEASE_ROOT"

echo "==> build packages + UI"
npm run build

echo "==> stage UI (exclude release staging)"
mkdir -p "$UI_OUT"
# Vite writes into dist/; release staging also lives under dist/ — copy only UI artifacts.
shopt -s nullglob
for entry in "$ROOT/dist"/*; do
  base="$(basename "$entry")"
  case "$base" in
    collector-release|collector-*.tar.gz|collector-*.zip) continue ;;
  esac
  # staged archive dirs from prior runs
  if [[ "$base" == collector-* ]]; then
    continue
  fi
  cp -a "$entry" "$UI_OUT/"
done
shopt -u nullglob
[[ -f "$UI_OUT/index.html" ]] || {
  echo "FAIL: vite build did not produce dist/index.html" >&2
  exit 1
}

echo "==> prepare packaged host"
COLLECTOR_HOST_OUT="$HOST_OUT" bash "$ROOT/scripts/prepare-service-host-resources.sh"

echo "==> write launchers"
cat >"$RELEASE_ROOT/collector" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR="$DIR/collector-service-host"
UI_DIR="$DIR/ui"
NODE="$HOST_DIR/node"
CLI="$HOST_DIR/cli.js"

if [[ ! -x "$NODE" && ! -f "$NODE" ]]; then
  echo "FAIL: bundled node missing at $NODE" >&2
  exit 1
fi
if [[ ! -f "$CLI" ]]; then
  echo "FAIL: host cli.js missing at $CLI" >&2
  exit 1
fi
if [[ ! -d "$UI_DIR" ]]; then
  echo "FAIL: ui directory missing at $UI_DIR" >&2
  exit 1
fi

DATA_DIR="${COLLECTOR_DATA_DIR:-}"
CONFIG_DIR="${COLLECTOR_CONFIG_DIR:-}"
PORT="${COLLECTOR_PORT:-0}"
HOST_BIND="${COLLECTOR_HOST:-127.0.0.1}"

ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --host) HOST_BIND="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: collector --data-dir <path> [--config-dir <path>] [--port 0] [--host 127.0.0.1]"
      echo "   or: COLLECTOR_DATA_DIR=<path> collector"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$DATA_DIR" ]]; then
  echo "FAIL: --data-dir or COLLECTOR_DATA_DIR required" >&2
  exit 2
fi

ARGS=(serve --data-dir "$DATA_DIR" --host "$HOST_BIND" --port "$PORT" --ui-dir "$UI_DIR")
if [[ -n "$CONFIG_DIR" ]]; then
  ARGS+=(--config-dir "$CONFIG_DIR")
fi

exec "$NODE" "$CLI" "${ARGS[@]}"
EOF
chmod +x "$RELEASE_ROOT/collector"

cat >"$RELEASE_ROOT/collector.cmd" <<'EOF'
@echo off
setlocal
set DIR=%~dp0
set HOST_DIR=%DIR%collector-service-host
set UI_DIR=%DIR%ui
set NODE=%HOST_DIR%\node.exe
if not exist "%NODE%" set NODE=%HOST_DIR%\node
set CLI=%HOST_DIR%\cli.js

if "%COLLECTOR_DATA_DIR%"=="" (
  echo FAIL: set COLLECTOR_DATA_DIR or pass --data-dir
  exit /b 2
)

"%NODE%" "%CLI%" serve --data-dir "%COLLECTOR_DATA_DIR%" --ui-dir "%UI_DIR%" %*
EOF

ARCHIVE_BASE="collector-${VERSION}-${OS_LABEL}-${ARCH_LABEL}"
STAGE="$ROOT/dist/${ARCHIVE_BASE}"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -a "$RELEASE_ROOT/." "$STAGE/"

case "$OS_LABEL" in
  windows)
    ARCHIVE="$ROOT/dist/${ARCHIVE_BASE}.zip"
    rm -f "$ARCHIVE"
    ( cd "$ROOT/dist" && zip -qr "${ARCHIVE_BASE}.zip" "$ARCHIVE_BASE" )
    ;;
  *)
    ARCHIVE="$ROOT/dist/${ARCHIVE_BASE}.tar.gz"
    rm -f "$ARCHIVE"
    tar -C "$ROOT/dist" -czf "$ARCHIVE" "$ARCHIVE_BASE"
    ;;
esac

rm -rf "$STAGE"
echo "OK: release bundle at $RELEASE_ROOT"
echo "OK: archive $ARCHIVE"
