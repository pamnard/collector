# Collector

Offline-first desktop app for saving and organizing content — articles, images, videos, notes, bookmarks, and more.

Built with **Tauri 2**, **React**, and **TypeScript**.

## Status

M0 foundation in progress — monorepo, vault filesystem, SQLite index, Tauri adapters.

See [Roadmap](docs/ROADMAP.md) and [GitHub Milestones](https://github.com/pamnard/collector/milestones).

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

### Build

```bash
npm run tauri build
```

## License

MIT
