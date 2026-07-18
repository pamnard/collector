# Collector

Offline-first desktop vault for saving and organizing content — articles, images, videos, notes, bookmarks, and more.

Built with **Tauri 2**, **React**, and **TypeScript**. Files on disk are the source of truth; SQLite powers search and filters.

## Status

Shipping desktop app (`v0.1.22`): vault CRUD, markdown items with YAML frontmatter, folder collections, tags, FTS search, grid/table UI, item detail (including raw markdown source edit), in-app updater, and GitHub Releases for Linux / macOS / Windows.

Installers: [GitHub Releases](https://github.com/pamnard/collector/releases/latest).

## How it works

| Layer | Role |
|-------|------|
| Vault on disk | Source of truth — markdown documents, tags, media sidecars |
| SQLite index | Disposable cache for search / filters / UI; rebuilt from vault if unhealthy |
| Settings | Theme, active vault, nav filter, updater prefs |

**Items** are vault-relative `.md` paths (path-as-id), not UUID folders. Metadata lives in YAML frontmatter; body is markdown. Per-item media sits in a sibling `note.media/` directory.

**Collections** are filesystem folders (`folder_path` = dirname of the item). There is no favorite / archive model (legacy settings map to “all”).

**Legacy** `items/<uuid>/` vaults are not converted on open. Migrate once with:

```bash
node scripts/migrate-vault-layout.mjs <vault-path>
```

## Monorepo

| Package | Purpose |
|---------|---------|
| `packages/shared` | Types, Zod schemas, constants |
| `packages/db` | SQLite migrations, index health / reset |
| `packages/core` | Vault filesystem + index operations |
| `src/` | Tauri app shell + React UI |
| `src-tauri/` | Rust commands, bundling, updater |

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

# release gate (maintainers; requires xvfb on Linux: apt install xvfb)
npm run verify:release
```

Release smoke already launches the built binary via `xvfb-run`; there is no supported headless mode for everyday `tauri:dev` without a display.

### Data locations

**Vault files** (markdown tree, tags, media) live under Tauri `appDataDir()`:

| Platform | Release | Dev (`tauri:dev`) |
|----------|---------|-------------------|
| Linux | `~/.local/share/com.collector.app/collector/` | `~/.local/share/com.collector.app.dev/collector/` |
| macOS | `~/Library/Application Support/com.collector.app/collector/` | `~/Library/Application Support/com.collector.app.dev/collector/` |
| Windows | `%APPDATA%\com.collector.app\collector\` | `%APPDATA%\com.collector.app.dev\collector\` |

**SQLite index** (`collector.db`) and **UI preferences** (`settings.json`) live under Tauri `appConfigDir()` — not next to the vault, and not in WebView `localStorage`:

| Platform | Release | Dev (`tauri:dev`) |
|----------|---------|-------------------|
| Linux | `~/.config/com.collector.app/` | `~/.config/com.collector.app.dev/` |
| macOS | `~/Library/Application Support/com.collector.app/` | `~/Library/Application Support/com.collector.app.dev/` |
| Windows | `%APPDATA%\com.collector.app\` | `%APPDATA%\com.collector.app.dev\` |

Settings file: `…/collector/settings.json`. Index DB: `…/collector.db` (same config root). Settings → «Каталог данных» shows the active vault data path.

**Upgrade** replaces the app binary only — vaults stay in place (`.deb` over `.deb`, or in-app updater).

**Uninstall** removes the app only; data dirs above are kept unless you delete them manually.

### Build

```bash
npm run tauri build
```

Useful checks:

```bash
npm run typecheck
npm test
npm run test:startup
npm run test:large-empty-index
```

### Release (maintainers)

Before tagging a GitHub release, run the full local gate (typecheck, unit tests, index smokes, frontend build, signed `tauri build`, headless binary smoke, Linux `.deb` packaging check):

```bash
export TAURI_SIGNING_PRIVATE_KEY=…   # required for signed updater artifacts
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=…
npm run verify:release
```

Implementation: [`scripts/verify-release.sh`](scripts/verify-release.sh). Tag `v*` on `main` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml) (draft GitHub Release + installers). Publish the draft when CI is green and assets are present; mark it as latest for the in-app updater.

## License

MIT
