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

echo "OK: $DEB — no maintainer scripts, no bundled user data"
