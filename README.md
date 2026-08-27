# Collector

Offline-first vault for saving and organizing content — articles, images, videos, notes, bookmarks, and more.

**Browser UI + local Node domain host.** Files on disk are the source of truth; SQLite powers search and filters. There is no Tauri / WebView shell on the supported product path.

## Status

Product path (`v0.1.38`): vault CRUD, markdown items with YAML frontmatter, folder collections, tags, FTS search, grid/table UI, item detail (including raw markdown source edit), host-served media, MCP/CLI as thin clients of the living host, and GitHub Releases archives (host + static UI).

Archives: [GitHub Releases](https://github.com/pamnard/collector/releases/latest).

**Updates are manual:** download a newer archive, stop the host, replace files, start again. There is no in-app auto-updater.

## How it works

| Layer | Role |
|-------|------|
| Domain host | Sole writer for the vault + SQLite index; HTTP RPC, events, media, static UI |
| Browser UI | Talks to the host (`POST /api/rpc`, `WS /api/events`, `/media/…`) |
| MCP / CLI | Thin clients of the same host (stdio MCP for editors) |
| Vault on disk | Source of truth — markdown documents, media sidecars; tag catalogs are derived from document frontmatter |
| SQLite index | Disposable cache for search / filters / UI; rebuilt from vault if unhealthy |

**Items** are vault-relative `.md` paths (path-as-id), not UUID folders. Metadata lives in YAML frontmatter; body is markdown. Per-item media sits in a sibling `note.media/` directory.

**Tags** are derived from document frontmatter names only (#842). Assigning or clearing tag names on an item updates every aggregated list (sidebar, picker, CLI/MCP views). Aggregated lists include only tags that currently appear on documents (`item_count > 0`); orphan catalog rows are omitted. There is no supported API to create, rename, or delete a catalog entry independently of documents, and no list→documents mass rewrite.

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
| `packages/service` | Domain host (HTTP + local dial) |
| `packages/client` | HTTP/WS client for the host |
| `packages/cli` / `packages/mcp` | Thin clients of the living host |
| `src/` | React UI (Vite) |

## Install (release archive)

1. Download `collector-<version>-<os>-<arch>.tar.gz` from [Releases](https://github.com/pamnard/collector/releases/latest).
2. Unpack.
3. Start the host (it also serves the UI):

```bash
./collector --data-dir /path/to/vault-data
# or: COLLECTOR_DATA_DIR=/path/to/vault-data ./collector
```

4. Open the `baseUrl` from the `COLLECTOR_SERVICE_READY` line in a normal browser (same origin serves `/` and `/api/*`).

Optional: `--config-dir` for a split settings directory; default is self-contained `{data-dir}/config` + `{data-dir}/collector.db`.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)

### Host + UI (recommended)

```bash
npm install
npm run build:packages
# data-dir = vault data directory
npm run dev:host -- --data-dir /path/to/vault-data
# optional: --ui-port 1430 if :1420 is already taken (launcher never kills an occupied port)
```

The launcher starts `collector-service serve`, waits for `COLLECTOR_SERVICE_READY`, reads `{data-dir}/collector-service.host-token`, then starts Vite with `VITE_COLLECTOR_SERVICE_BASE_URL` + `VITE_COLLECTOR_SERVICE_TOKEN` so the UI uses the real host (not DevMock).

**Sole-writer:** only one host may open the SQLite index for a given data-dir. A second `serve` on the same data-dir exits with code **3** and prints the holder pid. On stop (SIGINT/SIGTERM) the host releases `{data-dir}/collector-service.lock`; orphan holders are reclaimed on the next start.

Manual split:

```bash
npm run serve --workspace @collector/service -- --data-dir /path/to/vault-data
# READY line → baseUrl; token file under data-dir
VITE_COLLECTOR_SERVICE_BASE_URL=http://127.0.0.1:1421 \
VITE_COLLECTOR_SERVICE_TOKEN="$(tr -d '\n' < /path/to/vault-data/collector-service.host-token)" \
npm run dev -- --port 1430 --strictPort
```

Default `serve` listens on **1421** (`DEFAULT_SERVICE_HOST_PORT`). Pass `--port 0` for an ephemeral port (tests/smokes).

UI-only DevMock (no host): `npm run dev` on port **1420**.

Lifecycle smoke: `npm run test:service-host-lifecycle`.

### Data locations

You choose `--data-dir` (vault files + default self-contained layout). Settings → «Каталог данных» shows the active path once the UI is connected to the host.

**Upgrade** replaces the unpacked archive only — vault data stays where you pointed `--data-dir`.

## CLI and MCP

Release archives ship **`collector-cli`** and **`collector-mcp`** inside `collector-service-host/` (bundled Node + JS entrypoints). They are **thin clients** of the living host: start the host first (`./collector` or `npm run dev:host`), then point tools at it. They never open SQLite themselves.

**MCP** (`collector-mcp`) and **CLI** (`collector-cli`) dial the host over **HTTP** (`POST /api/rpc` + Bearer) using the same host token as the UI. Pass `--base-url` from the READY line and `--data-dir` (or `--token` / `COLLECTOR_HOST_TOKEN`). Missing host or bad auth fails loudly. MCP does not open the events WebSocket; RPC is HTTP-only. With `--data-dir` only (no pinned `--token`), MCP re-reads published base-url/token files once after auth failure so a host remint does not require restarting MCP. Cursor `mcp_auth` is not the host Bearer token.

Browser Vite env uses `VITE_COLLECTOR_SERVICE_*` (Vite requires the `VITE_` prefix). Node tools use `COLLECTOR_HOST_TOKEN` / the host token file — not the Vite names.

```bash
# from an unpacked release (READY line prints baseUrl)
./collector-service-host/collector-cli \
  --base-url http://127.0.0.1:PORT \
  --data-dir /path/to/vault-data \
  health

# MCP example (replace PORT / paths)
{
  "mcpServers": {
    "collector": {
      "command": "/absolute/path/to/collector-service-host/collector-mcp",
      "args": [
        "--base-url",
        "http://127.0.0.1:PORT",
        "--data-dir",
        "/path/to/vault-data"
      ]
    }
  }
}
```

Contributors from a checkout: `npm run build:packages`, then `npx collector-mcp --base-url … --data-dir …`.

### Agent skill (MCP / CLI)

Operational Agent Skill for vault work through the living host (not for editing this repo’s source): [`skills/collector-vault`](skills/collector-vault). Format: [Agent Skills](https://agentskills.io/specification).

Install examples:

```bash
npx skills add https://github.com/pamnard/collector --skill collector-vault
```

Or copy `skills/collector-vault/` into your agent’s skills directory (Claude Code / Codex / OpenCode — see that tool’s docs). Requires a running Collector host and configured MCP or `collector-cli`.

## Build and checks

```bash
npm run typecheck
npm test
npm run test:startup
npm run test:large-empty-index
npm run test:web-console
npm run build
```

Release archive locally:

```bash
npm run prepare:release-bundle
# → dist/collector-release/ and dist/collector-<ver>-<os>-<arch>.tar.gz
```

## Release (maintainers)

Before tagging a GitHub release, run the local gate:

```bash
npm run verify:release
```

This runs typecheck, tests, host smokes, frontend build, packs host+UI, and smokes the packaged archive (`/ping`, `/api/ui-bootstrap`, static UI, RPC). Implementation: [`scripts/verify-release.sh`](scripts/verify-release.sh).

Tag `v*` on `main` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml) (draft GitHub Release + tarball). Publish the draft when CI is green; updates remain **manual** downloads from Releases.

## License

MIT
