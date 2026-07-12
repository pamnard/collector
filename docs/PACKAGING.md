# Packaging and user data

Collector stores vaults and the SQLite index under Tauri `appDataDir()` — **outside** the install directory. Installers only ship the binary and desktop integration files.

## Data vs install paths

| Platform | Install location (examples) | User data |
|----------|----------------------------|-----------|
| Linux `.deb` | `/usr/bin/collector`, `/usr/share/applications/` | `~/.local/share/com.collector.app/collector/` |
| Linux AppImage | User-chosen mount/run location | `~/.local/share/com.collector.app/collector/` |
| macOS `.dmg` | `/Applications/Collector.app` | `~/Library/Application Support/com.collector.app/collector/` |
| Windows `.msi` / `.exe` | `Program Files\Collector\` | `%APPDATA%\com.collector.app\collector\` |

Dev builds (`tauri dev`) use identifier `com.collector.app.dev` — separate data tree. See [README](../README.md#data-locations).

## Upgrade

- **Linux `.deb`:** `sudo dpkg -i Collector_X.Y.Z_amd64.deb` over the previous version. Replaces `/usr/bin/collector` only; `~/.local/share/com.collector.app/` is untouched.
- **In-app updater:** replaces the application bundle; data dir unchanged (same `identifier`).
- **macOS:** drag new `.app` into `/Applications`, replace when prompted.
- **Windows:** run new `.msi` / setup `.exe` over the existing install.

**Verified:** upgrade 0.1.1 → 0.1.2 via in-app updater preserved vault and settings.

## Uninstall (default)

Tauri does **not** ship `post_remove_script` / `postRemoveScript` for our bundles. Uninstall removes the app binary only:

| Platform | Uninstall command | User data after uninstall |
|----------|-------------------|---------------------------|
| Linux `.deb` | `sudo apt remove collector` | **Kept** in `~/.local/share/com.collector.app/` |
| macOS | Move `Collector.app` to Trash | **Kept** in `~/Library/Application Support/com.collector.app/` |
| Windows | Settings → Apps → Uninstall | **Kept** in `%APPDATA%\com.collector.app\` |

## Full data removal (manual)

To wipe all vaults and the local index:

```bash
# Linux
rm -rf ~/.local/share/com.collector.app

# macOS
rm -rf ~/Library/Application\ Support/com.collector.app

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:APPDATA\com.collector.app"
```

Dev data (if used): replace `com.collector.app` with `com.collector.app.dev`.

## Maintainer checks

Before publishing a release:

1. `bundle.linux.deb` has **no** `postRemoveScript` / `post_install_script` that touches `appDataDir`
2. Run `scripts/verify-deb-packaging.sh path/to/Collector_*.deb` on the Linux artifact
3. Smoke-test upgrade on one machine (install N → add item → install N+1 → item present)
4. Optional: uninstall → confirm data dir still exists

See also [UPDATES.md](./UPDATES.md) for release signing and CI.
