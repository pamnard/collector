#!/usr/bin/env bash
# Verify a Collector .deb does not ship maintainer scripts that delete user data.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 path/to/Collector_*.deb" >&2
  exit 1
fi

DEB="$1"
if [[ ! -f "$DEB" ]]; then
  echo "File not found: $DEB" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

dpkg-deb -e "$DEB" "$TMP/control"

for script in preinst postinst prerm postrm; do
  if [[ -f "$TMP/control/$script" ]]; then
    echo "FAIL: unexpected maintainer script $script (must not delete user data)" >&2
    cat "$TMP/control/$script" >&2
    exit 1
  fi
done

if dpkg-deb -c "$DEB" | grep -qE '\.(local/share|Library/Application Support|AppData)'; then
  echo "FAIL: .deb must not bundle user data paths" >&2
  exit 1
fi

# Packaged sidecar (#165): present in the installer, not spawned by default (#166).
# Avoid `dpkg-deb | grep -q` under `pipefail`: early grep exit SIGPIPEs dpkg-deb and
# falsely fails even when the sidecar is listed.
deb_contents="$(dpkg-deb -c "$DEB")"
if ! grep -q 'collector-service' <<<"$deb_contents"; then
  echo "FAIL: .deb missing collector-service sidecar binary (#165)" >&2
  head -50 <<<"$deb_contents" >&2
  exit 1
fi

echo "OK: $DEB — no maintainer scripts, no bundled user data, sidecar present"
