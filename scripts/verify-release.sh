#!/usr/bin/env bash
# Local pre-release gate. Run before tagging/pushing a GitHub release.
#
# Usage:
#   npm run verify:release
#   ./scripts/verify-release.sh
#
# Optional:
#   TAURI_SIGNING_PRIVATE_KEY  — if set, tauri build must exit 0 (updater artifacts signed)
#   TAURI_BUNDLE_ARGS            — passed to `tauri build` (default: platform smoke bundle, deb on Linux)
#   SKIP_TAURI_BUILD=1           — skip full tauri build (faster; not for final release sign-off)
#   SKIP_RELEASE_SMOKE=1         — skip headless binary smoke (e.g. no xvfb on minimal CI image)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TAURI_LOG="/tmp/collector-verify-release-tauri.log"

# Never use a polluted HOME/RUSTUP from headless smoke runs in the same shell.
USER_HOME="$(getent passwd "$(whoami)" | cut -d: -f6)"
export RUSTUP_HOME="${USER_HOME}/.rustup"
export CARGO_HOME="${USER_HOME}/.cargo"
export PATH="${CARGO_HOME}/bin:${PATH}"
unset CARGO_TARGET_DIR

default_tauri_bundle_args() {
  if [[ -n "${TAURI_BUNDLE_ARGS:-}" ]]; then
    return
  fi
  case "$(uname -s)" in
    Linux) TAURI_BUNDLE_ARGS="--bundles deb" ;;
    Darwin) TAURI_BUNDLE_ARGS="--bundles dmg" ;;
    MINGW*|MSYS*|CYGWIN*) TAURI_BUNDLE_ARGS="--bundles msi" ;;
    *) TAURI_BUNDLE_ARGS="" ;;
  esac
}

release_binary_path() {
  local from_log=""
  if [[ -f "$TAURI_LOG" ]]; then
    from_log="$(grep -E 'Built application at:' "$TAURI_LOG" | tail -1 | sed 's/.*Built application at: //')"
  fi
  if [[ -n "$from_log" && -f "$from_log" ]]; then
    echo "$from_log"
    return
  fi
  case "$(uname -s)" in
    Linux|Darwin) echo "$ROOT/src-tauri/target/release/collector" ;;
    MINGW*|MSYS*|CYGWIN*) echo "$ROOT/src-tauri/target/release/collector.exe" ;;
  esac
}

linux_deb_path() {
  local from_log=""
  if [[ -f "$TAURI_LOG" ]]; then
    from_log="$(grep -E 'Bundling Collector_.*\.deb' "$TAURI_LOG" | tail -1 | grep -oE '\([^)]+\)' | tr -d '()' || true)"
  fi
  if [[ -n "$from_log" && -f "$from_log" ]]; then
    echo "$from_log"
    return
  fi
  find "$ROOT/src-tauri/target/release/bundle/deb" -name 'Collector_*.deb' 2>/dev/null | head -1
}

step() {
  echo ""
  echo "==> $1"
}

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

step "typecheck"
npm run typecheck

step "unit tests"
npm test

step "startup index smoke"
npm run test:startup

step "large empty-index smoke"
npm run test:large-empty-index

step "frontend + packages build"
npm run build

step "rust compile check"
( cd src-tauri && cargo check )

if [[ "${SKIP_TAURI_BUILD:-}" == "1" ]]; then
  echo "SKIP: tauri build (SKIP_TAURI_BUILD=1)"
else
  step "tauri release build"
  default_tauri_bundle_args
  # shellcheck disable=SC2206
  bundle_args=( ${TAURI_BUNDLE_ARGS} )
  echo "tauri build ${bundle_args[*]:-<default bundles>}"
  set +e
  npm run tauri build -- "${bundle_args[@]}" 2>&1 | tee "$TAURI_LOG"
  tauri_exit=${PIPESTATUS[0]}
  set -e

  if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    [[ "$tauri_exit" -eq 0 ]] || fail "tauri build exited $tauri_exit (signing key is set — must pass)"
  elif [[ "$tauri_exit" -ne 0 ]]; then
    if grep -q "no private key" "$TAURI_LOG"; then
      echo "WARN: tauri build exit $tauri_exit — missing TAURI_SIGNING_PRIVATE_KEY (binary may still exist)"
    elif grep -q "Built application at:" "$TAURI_LOG"; then
      echo "WARN: tauri build exit $tauri_exit after binary was built (see $TAURI_LOG)"
    else
      fail "tauri build exited $tauri_exit (see $TAURI_LOG)"
    fi
  fi
fi

if [[ "${SKIP_RELEASE_SMOKE:-}" == "1" ]]; then
  echo "SKIP: release binary smoke (SKIP_RELEASE_SMOKE=1)"
else
  step "release binary smoke"
  npm run build:packages

  BIN="$(release_binary_path)"
  [[ -f "$BIN" ]] || fail "release binary not found (expected after tauri build; see $TAURI_LOG)"

  if [[ "$(uname -s)" == "Linux" ]] && ! command -v xvfb-run >/dev/null 2>&1; then
    fail "xvfb-run required on Linux for headless release smoke (apt install xvfb)"
  fi

  node scripts/run-release-smoke.mjs "$BIN"
fi

if [[ "$(uname -s)" == "Linux" ]] && [[ "${SKIP_TAURI_BUILD:-}" != "1" ]]; then
  step "linux .deb packaging check"
  DEB="$(linux_deb_path)"
  if [[ -n "$DEB" ]]; then
    if ! command -v dpkg-deb >/dev/null 2>&1; then
      echo "WARN: dpkg-deb not found — skip verify-deb-packaging.sh"
    else
      "$ROOT/scripts/verify-deb-packaging.sh" "$DEB"
    fi
  else
    echo "WARN: no .deb artifact under src-tauri/target/release/bundle/deb"
  fi
fi

echo ""
echo "OK: verify:release passed — safe to tag and push for GitHub release"
