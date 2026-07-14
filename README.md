# Collector

Offline-first desktop app for saving and organizing content — articles, images, videos, notes, bookmarks, and more.

Built with **Tauri 2**, **React**, and **TypeScript**.

## Status

M1 app shell + M2 release pipeline (CI, updater). See [Roadmap](docs/ROADMAP.md).

## Monorepo

| Package | Purpose |
|---------|---------|
| `packages/shared` | Types, Zod schemas, constants |
| `packages/db` | SQLite migrations |
| `packages/core` | Vault filesystem + index operations |
| `src/` | Tauri app shell + React UI |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/tools/install)
- Platform deps for Tauri: [https://tauri.app/start/prerequisites/](https://tauri.app/start/prerequisites/)

### Run

```bash
npm install
npm run tauri:dev
```

`tauri:dev` uses bundle identifier `com.collector.app.dev` — a **separate data directory** from the installed release (`com.collector.app`). Dev and production vaults cannot collide unless you manually point at the same path.

### Linux dev quirks

`npm run tauri:dev` runs `scripts/tauri-dev.sh`, which frees stale Vite on port **1420** and raises the soft `ulimit -n` to **4096** when it is lower (avoids Tauri CLI panics from file watchers in this monorepo).

If `tauri dev` still fails with `Too many open files`, raise the limit in your shell or session:

```bash
ulimit -n 4096
```

**Headless / SSH** — Collector is a GUI app; it needs a display server (X11/Wayland) or a virtual framebuffer:

```bash
# headless dev (unusual)
xvfb-run -a npm run tauri:dev

# release binary smoke (maintainers)
npm run verify:release   # requires xvfb-run on Linux: apt install xvfb
```

Release smoke already launches the built binary via `xvfb-run`; there is no supported headless mode for everyday `tauri dev` without a display.

### Data locations

| Platform | Release | Dev (`tauri dev`) |
|----------|---------|-------------------|
| Linux | `~/.local/share/com.collector.app/collector/` | `~/.local/share/com.collector.app.dev/collector/` |
| macOS | `~/Library/Application Support/com.collector.app/collector/` | `~/Library/Application Support/com.collector.app.dev/collector/` |
| Windows | `%APPDATA%\com.collector.app\collector\` | `%APPDATA%\com.collector.app.dev\collector\` |

Vault files and the SQLite index live under `…/collector/`. Settings → «Каталог данных» shows the active path.

**Upgrade** replaces the app binary only — vaults stay in place (`.deb` over `.deb`, or in-app updater).

**Uninstall** removes the app only; data dirs above are kept unless you delete them manually. See [Packaging](docs/PACKAGING.md) for full removal commands and maintainer checks.

### Preferences (config)

UI preferences (`settings.json`) live under Tauri `appConfigDir()` — not in WebView `localStorage`:

| Platform | Release | Dev (`tauri dev`) |
|----------|---------|-------------------|
| Linux | `~/.config/com.collector.app/collector/settings.json` | `~/.config/com.collector.app.dev/collector/settings.json` |
| macOS | `~/Library/Application Support/com.collector.app/collector/settings.json` | `~/Library/Application Support/com.collector.app.dev/collector/settings.json` |
| Windows | `%APPDATA%\com.collector.app\collector\settings.json` | `%APPDATA%\com.collector.app.dev\collector\settings.json` |

Schema migrations: [DATABASE.md](docs/DATABASE.md), vault file format: [VAULT_SCHEMA.md](docs/VAULT_SCHEMA.md).

### Build

```bash
npm run tauri build
```

### Release (maintainers)

Before tagging a GitHub release:

```bash
npm run verify:release
```

Full workflow: [docs/RELEASE.md](docs/RELEASE.md).

## License

MIT
