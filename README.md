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
npm run tauri dev
```

`tauri dev` uses bundle identifier `com.collector.app.dev` — a **separate data directory** from the installed release (`com.collector.app`). Dev and production vaults cannot collide unless you manually point at the same path.

### Data locations

| Platform | Release | Dev (`tauri dev`) |
|----------|---------|-------------------|
| Linux | `~/.local/share/com.collector.app/collector/` | `~/.local/share/com.collector.app.dev/collector/` |
| macOS | `~/Library/Application Support/com.collector.app/collector/` | `~/Library/Application Support/com.collector.app.dev/collector/` |
| Windows | `%APPDATA%\com.collector.app\collector\` | `%APPDATA%\com.collector.app.dev\collector\` |

Vault files and the SQLite index live under `…/collector/`. Settings → «Каталог данных» shows the active path.

Explicit dev config merge file: `src-tauri/tauri.conf.dev.json` (applied automatically via `build.rs` when running `tauri dev`).

### Build

```bash
npm run tauri build
```

## License

MIT
