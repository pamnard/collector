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
#
# Linux precondition for `tauri build`:
#   @tauri-apps/cli creates one inotify instance while rewriting Cargo.toml.
#   Leftover Collector app processes hold inotify instances; this script stops
#   them before tauri build (dev release hygiene — not an end-user path).
#   Then probe-create one inotify instance. If that fails, FAIL clearly.
#   Do NOT raise fs.inotify.* / call sudo sysctl from this script — machine
#   limits are a one-time host setup, not a recurring release-gate side effect.
#   Plain `cargo build --release` in src-tauri does not need that watcher.
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

# One free slot is enough for tauri-cli's temporary Cargo.toml watcher.
INOTIFY_INSTANCES_NEEDED=1

# Stop leftover Collector app binaries so they release inotify instances before
# tauri-cli's Cargo.toml watcher. Does not touch IDEs/browsers.
stop_running_collector_binaries() {
  local pids=()
  local pid exe base still=()

  case "$(uname -s)" in
    Linux)
      mapfile -t pids < <(
        shopt -s nullglob
        for pid_path in /proc/[0-9]*; do
          pid="${pid_path#/proc/}"
          exe="$(readlink "/proc/${pid}/exe" 2>/dev/null || true)"
          [[ -n "$exe" ]] || continue
          # Kernel suffix " (deleted)" when binary was replaced on disk.
          exe="${exe% (deleted)}"
          base="$(basename "$exe")"
          if [[ "$base" == "collector" || "$base" == "collector.exe" ]]; then
            printf '%s\n' "$pid"
          fi
        done
      )
      ;;
    Darwin|MINGW*|MSYS*|CYGWIN*)
      mapfile -t pids < <(pgrep -x collector 2>/dev/null || true)
      ;;
    *)
      echo "skip stopping collector binaries on $(uname -s)"
      return 0
      ;;
  esac

  if [[ ${#pids[@]} -eq 0 ]]; then
    echo "no running collector binaries"
    return 0
  fi
  echo "stopping leftover collector binaries (pids: ${pids[*]})"
  kill -TERM "${pids[@]}" 2>/dev/null || true
  sleep 1
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      still+=("$pid")
    fi
  done
  if [[ ${#still[@]} -gt 0 ]]; then
    echo "force-killing collector binaries (pids: ${still[*]})"
    kill -KILL "${still[@]}" 2>/dev/null || true
    sleep 0.5
  fi
}

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

# Same resource tauri-cli needs: can we create one more inotify instance?
probe_inotify_instance_available() {
  python3 - <<'PY'
import ctypes
import errno
import os
import sys

libc = ctypes.CDLL(None, use_errno=True)
# linux/uapi: IN_CLOEXEC for inotify_init1
IN_CLOEXEC_INOTIFY = 0x80000
fd = libc.inotify_init1(IN_CLOEXEC_INOTIFY)
if fd < 0:
    err = ctypes.get_errno()
    sys.stderr.write(
        f"inotify_init1 failed errno={err} ({errno.errorcode.get(err, 'UNKNOWN')})\n"
    )
    sys.exit(1)
os.close(fd)
sys.exit(0)
PY
}

# Diagnostics only (anon inodes share st_ino; fork shares inflate raw fd counts).
count_user_inotify_instances() {
  python3 - <<'PY'
import ctypes
import os
import platform
import sys

uid = os.getuid()
fds = []
for name in os.listdir("/proc"):
    if not name.isdigit():
        continue
    try:
        with open(f"/proc/{name}/status", encoding="utf-8") as status:
            owner = None
            for line in status:
                if line.startswith("Uid:"):
                    owner = int(line.split()[1])
                    break
        if owner != uid:
            continue
    except OSError:
        continue
    pid = int(name)
    try:
        entries = os.listdir(f"/proc/{pid}/fd")
    except OSError:
        continue
    for entry in entries:
        path = f"/proc/{pid}/fd/{entry}"
        try:
            if os.readlink(path) != "anon_inode:inotify":
                continue
            fds.append((pid, int(entry)))
        except OSError:
            continue

sys_kcmp = {
    "x86_64": 312,
    "aarch64": 272,
}.get(platform.machine())
if sys_kcmp is None or not fds:
    print(len(fds))
    sys.exit(0)

libc = ctypes.CDLL(None, use_errno=True)
syscall = libc.syscall
syscall.restype = ctypes.c_long
KCMP_FILE = 0
reps = []
for pid, fd in fds:
    shared = False
    for rpid, rfd in reps:
        if (
            syscall(
                ctypes.c_long(sys_kcmp),
                ctypes.c_int(pid),
                ctypes.c_int(rpid),
                ctypes.c_int(KCMP_FILE),
                ctypes.c_ulong(fd),
                ctypes.c_ulong(rfd),
            )
            == 0
        ):
            shared = True
            break
    if not shared:
        reps.append((pid, fd))
print(len(reps))
PY
}

fail_inotify_instances_exhausted() {
  local max="$1"
  local used="$2"
  fail "inotify_init1 probe failed (EMFILE) after stopping leftover collector binaries. Estimated unique inotify instances: ${used}/${max}. Free other watchers (IDE/browser) or raise the host limit once outside this script — do not add sudo/sysctl here. See #104 / #111."
}

tauri_log_looks_like_inotify_emfile() {
  [[ -f "$TAURI_LOG" ]] || return 1
  grep -qE 'inotify_init|Too many open files|max_user_instances|interface/rust\.rs' "$TAURI_LOG"
}

ensure_linux_inotify_headroom_for_tauri() {
  [[ "$(uname -s)" == "Linux" ]] || return 0
  local max used
  max="$(cat /proc/sys/fs/inotify/max_user_instances)"
  used="$(count_user_inotify_instances)"
  echo "inotify instances: used ${used}/${max} (probe need >= ${INOTIFY_INSTANCES_NEEDED} free for tauri build)"
  if ! probe_inotify_instance_available; then
    fail_inotify_instances_exhausted "$max" "$used"
  fi
}

maybe_fail_tauri_log_inotify_emfile() {
  tauri_log_looks_like_inotify_emfile || return 0
  if [[ "$(uname -s)" == "Linux" ]]; then
    local max used
    max="$(cat /proc/sys/fs/inotify/max_user_instances)"
    used="$(count_user_inotify_instances)"
    fail_inotify_instances_exhausted "$max" "$used"
  fi
  fail "tauri build hit inotify/EMFILE-class failure (see $TAURI_LOG). See #104."
}

step "prepare service sidecar (#165)"
npm run prepare:service-sidecar
SIDECAR_TRIPLE="$(rustc --print host-tuple 2>/dev/null || rustc -vV | sed -n 's/^host: //p')"
SIDECAR_EXT=""
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) SIDECAR_EXT=".exe" ;;
esac
SIDECAR_BIN="$ROOT/src-tauri/binaries/collector-service-${SIDECAR_TRIPLE}${SIDECAR_EXT}"
[[ -f "$SIDECAR_BIN" ]] || fail "service sidecar missing at $SIDECAR_BIN (run prepare:service-sidecar)"
"$SIDECAR_BIN" --version | grep -q collector-service || fail "service sidecar --version failed"

step "typecheck"
npm run typecheck

step "unit tests"
npm test

step "startup index smoke"
npm run test:startup

step "service host health smoke (out-of-band)"
npm run test:service-host

step "service IPC health smoke (out-of-band)"
npm run test:service-ipc

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
  stop_running_collector_binaries
  ensure_linux_inotify_headroom_for_tauri
  default_tauri_bundle_args
  # shellcheck disable=SC2206
  bundle_args=( ${TAURI_BUNDLE_ARGS} )
  echo "tauri build ${bundle_args[*]:-<default bundles>}"
  set +e
  npm run tauri build -- "${bundle_args[@]}" 2>&1 | tee "$TAURI_LOG"
  tauri_exit=${PIPESTATUS[0]}
  set -e

  if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    if [[ "$tauri_exit" -ne 0 ]]; then
      maybe_fail_tauri_log_inotify_emfile
      fail "tauri build exited $tauri_exit (signing key is set — must pass)"
    fi
  elif [[ "$tauri_exit" -ne 0 ]]; then
    maybe_fail_tauri_log_inotify_emfile
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
  # Smoke must not leave collector/Xvfb behind (xvfb-run process-group teardown).
  stop_running_collector_binaries
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
