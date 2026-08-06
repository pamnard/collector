# Collector

Offline-first desktop vault for saving and organizing content — articles, images, videos, notes, bookmarks, and more.

Built with **Tauri 2**, **React**, and **TypeScript**. Files on disk are the source of truth; SQLite powers search and filters.

## Status

Shipping desktop app (`v0.1.24`): vault CRUD, markdown items with YAML frontmatter, folder collections, tags, FTS search, grid/table UI, item detail (including raw markdown source edit), in-app updater, and GitHub Releases for Linux / macOS / Windows.

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

### Service sidecar (internal)

Release builds package a `collector-service` sidecar (`bundle.externalBin`) plus a self-contained Node domain host under `resources/collector-service-host/` (bundled Node + `better-sqlite3`). The same host tree also ships user-facing **`collector-cli`** and **`collector-mcp`** wrappers (see [CLI and MCP](#cli-and-mcp-installed-app)). The sidecar and domain host are **internal** — not a separate daemon to install or configure.

Desktop app default is **service mode**: on start the UI bootstraps the supervised host over local IPC (opt out with `COLLECTOR_SERVICE_MODE=0`). The host is the sole SQLite writer.

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

### Local host + UI (without Tauri)

Contributors can run the **domain host** and the browser UI against it without the desktop shell:

```bash
npm run build:packages
# data-dir = vault data directory (Settings → «Каталог данных»)
npm run dev:host -- --data-dir /path/to/vault-data
# optional: --ui-port 1430 if :1420 is already taken (launcher never kills an occupied port)
```

The launcher starts `collector-service serve`, waits for `COLLECTOR_SERVICE_READY`, reads `{data-dir}/collector-service.host-token`, then starts Vite with `VITE_COLLECTOR_SERVICE_BASE_URL` + `VITE_COLLECTOR_SERVICE_TOKEN` so the UI uses the real host (not DevMock).

**Sole-writer:** only one host may open the SQLite index for a given data-dir. A second `serve` on the same data-dir exits with code **3** and prints the holder pid. On stop (SIGINT/SIGTERM) the host releases `{data-dir}/collector-service.lock`; orphan holders are reclaimed on the next start.

Manual split (same handoff):

```bash
npm run serve --workspace @collector/service -- --data-dir /path/to/vault-data
# READY line → baseUrl; token file under data-dir
VITE_COLLECTOR_SERVICE_BASE_URL=http://127.0.0.1:PORT \
VITE_COLLECTOR_SERVICE_TOKEN="$(tr -d '\n' < /path/to/vault-data/collector-service.host-token)" \
npm run dev -- --port 1430 --strictPort
```

Lifecycle smoke: `npm run test:service-host-lifecycle`.

### CLI and MCP (installed app)

Release installers ship **`collector-cli`** and **`collector-mcp`** inside the same host tree as the internal domain host (bundled Node + JS entrypoints). They are **thin clients** of that host: start the domain host first (desktop app, `npm run dev:host`, or out-of-band `serve`), then point tools at it. They never open SQLite themselves.

**MCP** (`collector-mcp`) is the market stdio entry: Cursor/Claude spawn it; the process dials the living host over **HTTP** (`POST /api/rpc` + Bearer) using the same host token as the UI. Pass `--base-url` from the host READY line (`COLLECTOR_SERVICE_READY` JSON includes `baseUrl`) and `--data-dir` so MCP can read the host token file under the vault data directory (or pass `--token` / `COLLECTOR_SERVICE_TOKEN`). Missing host or bad auth fails loudly — no silent empty backend. The launcher prints a ready-to-copy MCP command after READY.

**Install location** (wrappers + `*.js` + bundled `node`):

| Platform | Path |
|----------|------|
| Linux (`.deb`) | `/usr/lib/Collector/resources/collector-service-host/` |
| macOS | `Collector.app/Contents/Resources/` — look for `collector-service-host/` (or `resources/collector-service-host/`) |
| Windows | under the app install dir, `resources\collector-service-host\` |

Point MCP clients and shells at the **wrapper** in that folder (`collector-mcp` / `collector-cli` on Unix; `collector-mcp.cmd` / `collector-cli.cmd` on Windows). Use an absolute path — the installer does not put them on the system `PATH`.

`--data-dir` is the **vault data** directory from the table above (release column), e.g. Linux `~/.local/share/com.collector.app/collector/`. Settings → «Каталог данных» shows the active path.

```bash
# CLI health check (domain host must be running)
/usr/lib/Collector/resources/collector-service-host/collector-cli \
  --data-dir "$HOME/.local/share/com.collector.app/collector" \
  health
```

Example MCP stdio config (any client that supports stdio MCP). Replace the port with the host READY `baseUrl` (and paths for your OS/user):

```json
{
  "mcpServers": {
    "collector": {
      "command": "/usr/lib/Collector/resources/collector-service-host/collector-mcp",
      "args": [
        "--base-url",
        "http://127.0.0.1:PORT",
        "--data-dir",
        "/home/YOU/.local/share/com.collector.app/collector"
      ]
    }
  }
}
```

In-app Settings → MCP setup copy is tracked separately (#273).

**Contributors** can run from a checkout: `npm run build:packages`, then either `npm run dev:host -- --data-dir …` or start the domain host alone (READY prints `baseUrl`) and run `npx collector-mcp --base-url … --data-dir …` (or `COLLECTOR_SERVICE_BASE_URL` / `COLLECTOR_DATA_DIR`). End users should use the installer artifacts above.

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
# Browser console gate on :1420 (uses the stand if up; otherwise starts vite on 1420 and leaves it)
npm run test:web-console
```

### Release (maintainers)

Before tagging a GitHub release, run the full local gate (typecheck, unit tests, index smokes, frontend build, signed `tauri build`, headless binary smoke, Linux `.deb` packaging check):

```bash
# Signing key is picked up from ~/.tauri/collector.key when unset
# (optional passphrase file: ~/.tauri/collector.key.password)
npm run verify:release
```

Implementation: [`scripts/verify-release.sh`](scripts/verify-release.sh). Tag `v*` on `main` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml) (draft GitHub Release + installers). Publish the draft when CI is green and assets are present; mark it as latest for the in-app updater.

## License

MIT
