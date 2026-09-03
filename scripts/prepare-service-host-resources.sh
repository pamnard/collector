#!/usr/bin/env bash
# Build a self-contained Node domain host tree for release packaging (#555).
# Output: dist/collector-release/collector-service-host/
#   {cli.js, collector-cli.js, collector-mcp.js, wrappers, node, node_modules/…}
# User-facing CLI/MCP (#258) reuse the same bundled Node.
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
NAPI_RS_KEYRING_VERSION="${COLLECTOR_NAPI_RS_KEYRING_VERSION:-1.3.0}"
# Static ffmpeg for video cover.webp extract (#267). Override to pin / skip fetch.
FFMPEG_STATIC_VERSION="${COLLECTOR_FFMPEG_STATIC_VERSION:-5.3.0}"
# Standalone yt-dlp for YouTube extract (#317). Override to pin.
YT_DLP_VERSION="${COLLECTOR_YT_DLP_VERSION:-2026.08.19}"

HOST_OUT="${COLLECTOR_HOST_OUT:-$ROOT/dist/collector-release/collector-service-host}"
CACHE_ROOT="${COLLECTOR_NODE_CACHE:-$ROOT/.cache/collector-node/node-v${NODE_VERSION}}"
ESBUILD="$ROOT/node_modules/esbuild/bin/esbuild"

detect_platform_arch() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Linux)
      case "$arch" in
        x86_64) echo "linux-x64" ;;
        aarch64|arm64) echo "linux-arm64" ;;
        *) echo "FAIL: unsupported Linux arch: $arch" >&2; exit 1 ;;
      esac
      ;;
    Darwin)
      case "$arch" in
        x86_64) echo "darwin-x64" ;;
        arm64) echo "darwin-arm64" ;;
        *) echo "FAIL: unsupported Darwin arch: $arch" >&2; exit 1 ;;
      esac
      ;;
    MINGW*|MSYS*|CYGWIN*)
      case "$arch" in
        x86_64|amd64) echo "win-x64" ;;
        aarch64|arm64) echo "win-arm64" ;;
        *) echo "FAIL: unsupported Windows arch: $arch" >&2; exit 1 ;;
      esac
      ;;
    *)
      echo "FAIL: unsupported OS: $os" >&2
      exit 1
      ;;
  esac
}

PLATFORM_ARCH="$(detect_platform_arch)"
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
npm run build --workspace @collector/client
npm run build --workspace @collector/cli
npm run build --workspace @collector/mcp

HOST_CLI_SRC="$ROOT/packages/service/dist/host/cli.js"
USER_CLI_SRC="$ROOT/packages/cli/dist/main.js"
MCP_SRC="$ROOT/packages/mcp/dist/main.js"
if [[ ! -f "$HOST_CLI_SRC" ]]; then
  echo "FAIL: missing $HOST_CLI_SRC" >&2
  exit 1
fi
if [[ ! -f "$USER_CLI_SRC" ]]; then
  echo "FAIL: missing $USER_CLI_SRC" >&2
  exit 1
fi
if [[ ! -f "$MCP_SRC" ]]; then
  echo "FAIL: missing $MCP_SRC" >&2
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
  --external:@napi-rs/keyring \
  --outfile="$HOST_OUT/cli.js"

echo "==> esbuild user CLI + MCP (#258) → $HOST_OUT/collector-{cli,mcp}.js"
"$ESBUILD" "$USER_CLI_SRC" \
  --bundle \
  --platform=node \
  --format=cjs \
  --packages=bundle \
  --external:better-sqlite3 \
  --external:sharp \
  --external:@napi-rs/keyring \
  --outfile="$HOST_OUT/collector-cli.js"
"$ESBUILD" "$MCP_SRC" \
  --bundle \
  --platform=node \
  --format=cjs \
  --packages=bundle \
  --external:better-sqlite3 \
  --external:sharp \
  --external:@napi-rs/keyring \
  --outfile="$HOST_OUT/collector-mcp.js"

# Thin wrappers: invoke bundled Node + JS (always ship unix + .cmd).
write_unix_wrapper() {
  local name="$1"
  local js="$2"
  cat >"$HOST_OUT/${name}" <<EOF
#!/bin/sh
DIR=\$(CDPATH= cd -- "\$(dirname "\$0")" && pwd)
NODE="\$DIR/node"
if [ -f "\$DIR/node.exe" ]; then
  NODE="\$DIR/node.exe"
fi
exec "\$NODE" "\$DIR/${js}" "\$@"
EOF
  chmod +x "$HOST_OUT/${name}"
}

write_cmd_wrapper() {
  local name="$1"
  local js="$2"
  cat >"$HOST_OUT/${name}.cmd" <<EOF
@echo off
"%~dp0node.exe" "%~dp0${js}" %*
EOF
}

write_unix_wrapper "collector-cli" "collector-cli.js"
write_unix_wrapper "collector-mcp" "collector-mcp.js"
write_cmd_wrapper "collector-cli" "collector-cli.js"
write_cmd_wrapper "collector-mcp" "collector-mcp.js"

cat >"$HOST_OUT/package.json" <<'EOF'
{
  "name": "collector-service-host",
  "private": true
}
EOF
cp -f "$BUNDLED_NODE" "$HOST_OUT/${NODE_BIN_NAME}"
chmod +x "$HOST_OUT/${NODE_BIN_NAME}" 2>/dev/null || true

echo "==> rebuild better-sqlite3@${BETTER_SQLITE3_VERSION} + sharp@${SHARP_VERSION} + @napi-rs/keyring@${NAPI_RS_KEYRING_VERSION} against bundled Node"
REBUILD_DIR="$CACHE_ROOT/native-modules-rebuild-${PLATFORM_ARCH}"
rm -rf "$REBUILD_DIR"
mkdir -p "$REBUILD_DIR"
cat >"$REBUILD_DIR/package.json" <<EOF
{
  "name": "collector-native-modules-rebuild",
  "private": true,
  "dependencies": {
    "better-sqlite3": "${BETTER_SQLITE3_VERSION}",
    "sharp": "${SHARP_VERSION}",
    "@napi-rs/keyring": "${NAPI_RS_KEYRING_VERSION}"
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

echo "==> fetch ffmpeg-static@${FFMPEG_STATIC_VERSION} → $HOST_OUT/bin (#267)"
FFMPEG_FETCH_DIR="$CACHE_ROOT/ffmpeg-static-${PLATFORM_ARCH}-v${FFMPEG_STATIC_VERSION}"
FFMPEG_BIN_NAME="ffmpeg"
if [[ "$IS_WIN" -eq 1 ]]; then
  FFMPEG_BIN_NAME="ffmpeg.exe"
fi
mkdir -p "$FFMPEG_FETCH_DIR"
if [[ ! -f "$FFMPEG_FETCH_DIR/${FFMPEG_BIN_NAME}" ]]; then
  cat >"$FFMPEG_FETCH_DIR/package.json" <<EOF
{
  "name": "collector-ffmpeg-static-fetch",
  "private": true,
  "dependencies": {
    "ffmpeg-static": "${FFMPEG_STATIC_VERSION}"
  }
}
EOF
  (
    cd "$FFMPEG_FETCH_DIR"
    export npm_config_arch="$NPM_ARCH"
    export npm_config_platform="$NPM_PLATFORM"
    # ffmpeg-static postinstall downloads the platform binary.
    npm install --ignore-scripts=false
  )
  FETCHED="$(
    cd "$FFMPEG_FETCH_DIR"
    node -e "process.stdout.write(require('ffmpeg-static'))"
  )"
  if [[ -z "$FETCHED" || ! -f "$FETCHED" ]]; then
    echo "FAIL: ffmpeg-static did not resolve a binary at $FFMPEG_FETCH_DIR" >&2
    exit 1
  fi
  cp -f "$FETCHED" "$FFMPEG_FETCH_DIR/${FFMPEG_BIN_NAME}"
  chmod +x "$FFMPEG_FETCH_DIR/${FFMPEG_BIN_NAME}" 2>/dev/null || true
fi
mkdir -p "$HOST_OUT/bin"
cp -f "$FFMPEG_FETCH_DIR/${FFMPEG_BIN_NAME}" "$HOST_OUT/bin/${FFMPEG_BIN_NAME}"
chmod +x "$HOST_OUT/bin/${FFMPEG_BIN_NAME}" 2>/dev/null || true
if [[ ! -f "$HOST_OUT/bin/${FFMPEG_BIN_NAME}" ]]; then
  echo "FAIL: missing bundled ffmpeg at $HOST_OUT/bin/${FFMPEG_BIN_NAME}" >&2
  exit 1
fi

echo "==> fetch yt-dlp@${YT_DLP_VERSION} → $HOST_OUT/bin (#317)"
# Shared cache with packages/service/scripts/ensure-host-ytdlp.mjs
YT_DLP_FETCH_DIR="$ROOT/.cache/collector-node/yt-dlp-${PLATFORM_ARCH}-v${YT_DLP_VERSION}"
YT_DLP_BIN_NAME="yt-dlp"
YT_DLP_ASSET=""
YT_DLP_SHA256=""
case "$PLATFORM_ARCH" in
  linux-x64)
    YT_DLP_ASSET="yt-dlp_linux"
    YT_DLP_SHA256="58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a"
    ;;
  linux-arm64)
    YT_DLP_ASSET="yt-dlp_linux_aarch64"
    YT_DLP_SHA256="b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc"
    ;;
  darwin-*)
    YT_DLP_ASSET="yt-dlp_macos"
    YT_DLP_SHA256="0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202"
    ;;
  win-*)
    YT_DLP_BIN_NAME="yt-dlp.exe"
    YT_DLP_ASSET="yt-dlp.exe"
    YT_DLP_SHA256="66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a"
    ;;
  *)
    echo "FAIL: no yt-dlp asset mapping for $PLATFORM_ARCH" >&2
    exit 1
    ;;
esac
mkdir -p "$YT_DLP_FETCH_DIR"
YT_DLP_CACHE_BIN="$YT_DLP_FETCH_DIR/${YT_DLP_BIN_NAME}"
if [[ ! -f "$YT_DLP_CACHE_BIN" ]]; then
  YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${YT_DLP_ASSET}"
  download "$YT_DLP_URL" "$YT_DLP_CACHE_BIN"
  chmod +x "$YT_DLP_CACHE_BIN" 2>/dev/null || true
fi
ACTUAL_SHA="$(sha256sum "$YT_DLP_CACHE_BIN" | awk '{print $1}')"
if [[ "$ACTUAL_SHA" != "$YT_DLP_SHA256" ]]; then
  echo "FAIL: yt-dlp sha256 mismatch for $YT_DLP_CACHE_BIN" >&2
  echo "  got:      $ACTUAL_SHA" >&2
  echo "  expected: $YT_DLP_SHA256" >&2
  exit 1
fi
mkdir -p "$HOST_OUT/bin"
cp -f "$YT_DLP_CACHE_BIN" "$HOST_OUT/bin/${YT_DLP_BIN_NAME}"
chmod +x "$HOST_OUT/bin/${YT_DLP_BIN_NAME}" 2>/dev/null || true
if [[ ! -f "$HOST_OUT/bin/${YT_DLP_BIN_NAME}" ]]; then
  echo "FAIL: missing bundled yt-dlp at $HOST_OUT/bin/${YT_DLP_BIN_NAME}" >&2
  exit 1
fi

echo "==> ABI probe: open :memory: DB + sharp with bundled Node"
(
  cd "$HOST_OUT"
  "./${NODE_BIN_NAME}" -e "require('better-sqlite3')(':memory:'); console.log('better-sqlite3 ok')"
  "./${NODE_BIN_NAME}" -e "require('sharp'); console.log('sharp ok')"
  "./${NODE_BIN_NAME}" -e "require('@napi-rs/keyring'); console.log('keyring ok')"
  "./bin/${FFMPEG_BIN_NAME}" -version | head -1
  "./bin/${YT_DLP_BIN_NAME}" --version | head -1
)

echo "==> smoke: bundled host --help"
(
  cd "$HOST_OUT"
  "./${NODE_BIN_NAME}" ./cli.js 2>&1 | head -5 || true
)

echo "==> smoke: packaged CLI/MCP entrypoints (#258)"
(
  cd "$HOST_OUT"
  set +e
  out_cli="$("./${NODE_BIN_NAME}" ./collector-cli.js 2>&1)"
  code_cli=$?
  out_mcp="$("./${NODE_BIN_NAME}" ./collector-mcp.js 2>&1)"
  code_mcp=$?
  set -e
  echo "$out_cli" | head -3
  echo "$out_mcp" | head -3
  if [[ "$code_cli" -eq 0 ]]; then
    echo "FAIL: collector-cli.js without endpoint should be non-zero" >&2
    exit 1
  fi
  if ! grep -q 'Usage: collector-cli\|Service endpoint required' <<<"$out_cli"; then
    echo "FAIL: collector-cli.js missing usage/endpoint message" >&2
    echo "$out_cli" >&2
    exit 1
  fi
  if [[ "$code_mcp" -eq 0 ]]; then
    echo "FAIL: collector-mcp.js without endpoint should be non-zero" >&2
    exit 1
  fi
  if ! grep -qE 'Host endpoint required|Service endpoint required|base-url|data-dir|COLLECTOR_SERVICE' <<<"$out_mcp"; then
    echo "FAIL: collector-mcp.js missing endpoint message" >&2
    echo "$out_mcp" >&2
    exit 1
  fi
)

if [[ ! -f "$HOST_OUT/cli.js" ]]; then
  echo "FAIL: missing $HOST_OUT/cli.js" >&2
  exit 1
fi
if [[ ! -f "$HOST_OUT/collector-cli.js" ]]; then
  echo "FAIL: missing $HOST_OUT/collector-cli.js (#258)" >&2
  exit 1
fi
if [[ ! -f "$HOST_OUT/collector-mcp.js" ]]; then
  echo "FAIL: missing $HOST_OUT/collector-mcp.js (#258)" >&2
  exit 1
fi
if [[ ! -f "$HOST_OUT/collector-cli" || ! -f "$HOST_OUT/collector-mcp" ]]; then
  echo "FAIL: missing unix wrappers collector-cli / collector-mcp (#258)" >&2
  exit 1
fi
if [[ ! -f "$HOST_OUT/collector-cli.cmd" || ! -f "$HOST_OUT/collector-mcp.cmd" ]]; then
  echo "FAIL: missing Windows .cmd wrappers (#258)" >&2
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
if [[ ! -d "$HOST_OUT/node_modules/@napi-rs/keyring" ]]; then
  echo "FAIL: missing @napi-rs/keyring under $HOST_OUT" >&2
  exit 1
fi
if [[ ! -f "$HOST_OUT/bin/${FFMPEG_BIN_NAME}" ]]; then
  echo "FAIL: missing ffmpeg under $HOST_OUT/bin" >&2
  exit 1
fi
if [[ ! -f "$HOST_OUT/bin/${YT_DLP_BIN_NAME}" ]]; then
  echo "FAIL: missing yt-dlp under $HOST_OUT/bin" >&2
  exit 1
fi

echo "OK: prepared service host resources at $HOST_OUT"
