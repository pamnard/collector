#!/usr/bin/env bash
# Build a self-contained Node domain host tree for Tauri resources.
# Output: src-tauri/resources/collector-service-host/{cli.js,node,node_modules/better-sqlite3,…}
#
# ABI: better-sqlite3 is rebuilt against the *bundled* Node + matching headers
# (not the system Node used for the rest of the monorepo).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Pin: must match downloaded binary + headers tarballs below.
NODE_VERSION="${COLLECTOR_BUNDLED_NODE_VERSION:-22.22.3}"
BETTER_SQLITE3_VERSION="${COLLECTOR_BETTER_SQLITE3_VERSION:-11.10.0}"
SHARP_VERSION="${COLLECTOR_SHARP_VERSION:-0.34.2}"

HOST_OUT="$ROOT/src-tauri/resources/collector-service-host"
CACHE_ROOT="${COLLECTOR_NODE_CACHE:-$ROOT/src-tauri/.cache/node-v${NODE_VERSION}}"
ESBUILD="$ROOT/node_modules/esbuild/bin/esbuild"

TRIPLE="$(rustc --print host-tuple 2>/dev/null || true)"
if [[ -z "$TRIPLE" ]]; then
  TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
fi
if [[ -z "$TRIPLE" ]]; then
  echo "FAIL: could not determine Rust host triple" >&2
  exit 1
fi

node_platform_arch() {
  case "$1" in
    x86_64-unknown-linux-gnu) echo "linux-x64" ;;
    aarch64-unknown-linux-gnu) echo "linux-arm64" ;;
    x86_64-pc-windows-msvc | x86_64-pc-windows-gnu) echo "win-x64" ;;
    aarch64-pc-windows-msvc) echo "win-arm64" ;;
    x86_64-apple-darwin) echo "darwin-x64" ;;
    aarch64-apple-darwin) echo "darwin-arm64" ;;
    *)
      echo "FAIL: unsupported triple for bundled Node: $1" >&2
      exit 1
      ;;
  esac
}

PLATFORM_ARCH="$(node_platform_arch "$TRIPLE")"
IS_WIN=0
NODE_BIN_NAME="node"
ARCHIVE_EXT="tar.xz"
case "$PLATFORM_ARCH" in
  win-*)
    IS_WIN=1
    NODE_BIN_NAME="node.exe"
    ARCHIVE_EXT="zip"
    ;;
esac

NODE_DIST_BASE="https://nodejs.org/dist/v${NODE_VERSION}"
NODE_ARCHIVE="node-v${NODE_VERSION}-${PLATFORM_ARCH}.${ARCHIVE_EXT}"
HEADERS_ARCHIVE="node-v${NODE_VERSION}-headers.tar.gz"
NODE_CACHE_DIR="$CACHE_ROOT/${PLATFORM_ARCH}"
HEADERS_DIR="$CACHE_ROOT/headers"
NODE_EXTRACT="$NODE_CACHE_DIR/extract"
HEADERS_EXTRACT="$HEADERS_DIR/extract"

mkdir -p "$CACHE_ROOT" "$NODE_CACHE_DIR" "$HEADERS_DIR"

download() {
  local url="$1"
  local dest="$2"
  if [[ -f "$dest" ]]; then
    return 0
  fi
  echo "==> download $url"
  curl -fsSL --retry 3 --retry-delay 2 -o "${dest}.partial" "$url"
  mv "${dest}.partial" "$dest"
}

echo "==> ensure bundled Node v${NODE_VERSION} (${PLATFORM_ARCH})"
download "${NODE_DIST_BASE}/${NODE_ARCHIVE}" "$NODE_CACHE_DIR/${NODE_ARCHIVE}"
download "${NODE_DIST_BASE}/${HEADERS_ARCHIVE}" "$HEADERS_DIR/${HEADERS_ARCHIVE}"

if [[ ! -x "$NODE_EXTRACT/bin/${NODE_BIN_NAME}" && ! -f "$NODE_EXTRACT/${NODE_BIN_NAME}" ]]; then
  rm -rf "$NODE_EXTRACT"
  mkdir -p "$NODE_EXTRACT"
  if [[ "$IS_WIN" -eq 1 ]]; then
    unzip -q -o "$NODE_CACHE_DIR/${NODE_ARCHIVE}" -d "$NODE_EXTRACT"
    # zip layout: node-vVER-win-x64/node.exe
    INNER="$(find "$NODE_EXTRACT" -maxdepth 2 -name "$NODE_BIN_NAME" | head -1)"
    if [[ -z "$INNER" ]]; then
      echo "FAIL: node.exe missing in $NODE_ARCHIVE" >&2
      exit 1
    fi
  else
    tar -xJf "$NODE_CACHE_DIR/${NODE_ARCHIVE}" -C "$NODE_EXTRACT" --strip-components=1
  fi
fi

if [[ ! -d "$HEADERS_EXTRACT/include/node" ]]; then
  rm -rf "$HEADERS_EXTRACT"
  mkdir -p "$HEADERS_EXTRACT"
  tar -xzf "$HEADERS_DIR/${HEADERS_ARCHIVE}" -C "$HEADERS_EXTRACT" --strip-components=1
fi

if [[ "$IS_WIN" -eq 1 ]]; then
  BUNDLED_NODE="$(find "$NODE_EXTRACT" -maxdepth 2 -name "$NODE_BIN_NAME" | head -1)"
else
  BUNDLED_NODE="$NODE_EXTRACT/bin/node"
fi
if [[ ! -f "$BUNDLED_NODE" ]]; then
  echo "FAIL: bundled node binary missing at $BUNDLED_NODE" >&2
  exit 1
fi
chmod +x "$BUNDLED_NODE" 2>/dev/null || true

NODEDIR="$HEADERS_EXTRACT"
if [[ ! -d "$NODEDIR/include/node" ]]; then
  echo "FAIL: node headers missing under $NODEDIR/include/node" >&2
  exit 1
fi

echo "==> build workspace packages for host bundle"
npm run build --workspace @collector/shared
npm run build --workspace @collector/api
npm run build --workspace @collector/db
npm run build --workspace @collector/core
npm run build --workspace @collector/service

HOST_CLI_SRC="$ROOT/packages/service/dist/host/cli.js"
if [[ ! -f "$HOST_CLI_SRC" ]]; then
  echo "FAIL: missing $HOST_CLI_SRC" >&2
  exit 1
fi
if [[ ! -x "$ESBUILD" && ! -f "$ESBUILD" ]]; then
  echo "FAIL: esbuild not found at $ESBUILD (npm install)" >&2
  exit 1
fi

rm -rf "$HOST_OUT"
mkdir -p "$HOST_OUT/node_modules"

echo "==> esbuild domain host → $HOST_OUT/cli.js"
"$ESBUILD" "$HOST_CLI_SRC" \
  --bundle \
  --platform=node \
  --format=cjs \
  --packages=bundle \
  --external:better-sqlite3 \
  --external:sharp \
  --outfile="$HOST_OUT/cli.js"

cat >"$HOST_OUT/package.json" <<'EOF'
{
  "name": "collector-service-host",
  "private": true
}
EOF
cp -f "$BUNDLED_NODE" "$HOST_OUT/${NODE_BIN_NAME}"
chmod +x "$HOST_OUT/${NODE_BIN_NAME}" 2>/dev/null || true

echo "==> rebuild better-sqlite3@${BETTER_SQLITE3_VERSION} + sharp@${SHARP_VERSION} against bundled Node"
REBUILD_DIR="$CACHE_ROOT/native-modules-rebuild-${PLATFORM_ARCH}"
rm -rf "$REBUILD_DIR"
mkdir -p "$REBUILD_DIR"
cat >"$REBUILD_DIR/package.json" <<EOF
{
  "name": "collector-native-modules-rebuild",
  "private": true,
  "dependencies": {
    "better-sqlite3": "${BETTER_SQLITE3_VERSION}",
    "sharp": "${SHARP_VERSION}"
  }
}
EOF

# Use the tarball's npm under the bundled Node so install/gyp see that ABI.
BUNDLED_NPM="$NODE_EXTRACT/lib/node_modules/npm/bin/npm-cli.js"
if [[ ! -f "$BUNDLED_NPM" ]]; then
  # Windows layout: node_modules/npm next to node.exe
  BUNDLED_NPM="$(find "$NODE_EXTRACT" -path '*/npm/bin/npm-cli.js' | head -1 || true)"
fi
if [[ ! -f "$BUNDLED_NPM" ]]; then
  echo "FAIL: bundled npm-cli.js not found under $NODE_EXTRACT" >&2
  exit 1
fi

case "$PLATFORM_ARCH" in
  *-x64) NPM_ARCH="x64" ;;
  *-arm64) NPM_ARCH="arm64" ;;
  *)
    echo "FAIL: cannot map $PLATFORM_ARCH to npm_config_arch" >&2
    exit 1
    ;;
esac
case "$PLATFORM_ARCH" in
  linux-*) NPM_PLATFORM="linux" ;;
  win-*) NPM_PLATFORM="win32" ;;
  darwin-*) NPM_PLATFORM="darwin" ;;
  *)
    echo "FAIL: cannot map $PLATFORM_ARCH to npm_config_platform" >&2
    exit 1
    ;;
esac

(
  cd "$REBUILD_DIR"
  # Prefer official prebuilds for NODE_VERSION (no MSVC/node-gyp on Windows CI).
  # Fall back to headers + source only if prebuild is missing.
  export PATH="$(dirname "$BUNDLED_NODE"):$PATH"
  export npm_config_target="$NODE_VERSION"
  export npm_config_runtime="node"
  export npm_config_arch="$NPM_ARCH"
  export npm_config_platform="$NPM_PLATFORM"
  export npm_config_disturl="https://nodejs.org/dist"
  unset npm_config_build_from_source || true
  if ! "$BUNDLED_NODE" "$BUNDLED_NPM" install --ignore-scripts=false; then
    echo "==> prebuild install failed; retrying with nodedir + build-from-source"
    export npm_config_nodedir="$NODEDIR"
    export npm_config_build_from_source="true"
    "$BUNDLED_NODE" "$BUNDLED_NPM" install --ignore-scripts=false
  fi
)

if [[ ! -d "$REBUILD_DIR/node_modules/better-sqlite3" ]]; then
  echo "FAIL: better-sqlite3 missing after rebuild in $REBUILD_DIR" >&2
  exit 1
fi
if [[ ! -d "$REBUILD_DIR/node_modules/sharp" ]]; then
  echo "FAIL: sharp missing after rebuild in $REBUILD_DIR" >&2
  exit 1
fi
# Copy full runtime node_modules (better-sqlite3 + sharp + deps like bindings).
# Drop native build intermediates to shrink the tree.
find "$REBUILD_DIR/node_modules" -type d \( -name obj.target -o -name .deps \) -prune -exec rm -rf {} + 2>/dev/null || true
rm -rf "$REBUILD_DIR/node_modules/better-sqlite3/deps" \
  "$REBUILD_DIR/node_modules/better-sqlite3/src" \
  "$REBUILD_DIR/node_modules/better-sqlite3/test" \
  2>/dev/null || true

rm -rf "$HOST_OUT/node_modules"
cp -a "$REBUILD_DIR/node_modules" "$HOST_OUT/node_modules"

echo "==> ABI probe: open :memory: DB + sharp with bundled Node"
(
  cd "$HOST_OUT"
  "./${NODE_BIN_NAME}" -e "require('better-sqlite3')(':memory:'); console.log('better-sqlite3 ok')"
  "./${NODE_BIN_NAME}" -e "require('sharp'); console.log('sharp ok')"
)

echo "==> smoke: bundled host --help"
(
  cd "$HOST_OUT"
  "./${NODE_BIN_NAME}" ./cli.js 2>&1 | head -5 || true
)

if [[ ! -f "$HOST_OUT/cli.js" ]]; then
  echo "FAIL: missing $HOST_OUT/cli.js" >&2
  exit 1
fi
if [[ ! -f "$HOST_OUT/${NODE_BIN_NAME}" ]]; then
  echo "FAIL: missing $HOST_OUT/${NODE_BIN_NAME}" >&2
  exit 1
fi
if [[ ! -d "$HOST_OUT/node_modules/better-sqlite3" ]]; then
  echo "FAIL: missing better-sqlite3 under $HOST_OUT" >&2
  exit 1
fi
if [[ ! -d "$HOST_OUT/node_modules/sharp" ]]; then
  echo "FAIL: missing sharp under $HOST_OUT" >&2
  exit 1
fi

echo "OK: prepared service host resources at $HOST_OUT"
