# Collector — Roadmap

Offline-first desktop vault for articles, images, videos, notes, bookmarks, and more.
Obsidian-like file storage + SQLite index. Sync from external sources via plugins.

Stack: **Tauri 2**, **React**, **TypeScript**, **SQLite**, files on disk.

---

## Milestones

| # | Milestone | Goal |
|---|-----------|------|
| M0 | Foundation | Project structure, data layer, Tauri integration |
| M1 | Shell & Users | Local multi-user auth, app layout, navigation |
| M2 | Content Core | CRUD, tags, collections, search, list/detail UI |
| M3 | Capture & Portability | Import, export, manual capture, reindex |
| M4 | Sync Plugins | Plugin system + Reddit / Telegram / Pinterest |
| M5 | Polish & Release | Previews, CI, migration, encryption, auto-update |

---

## M0 — Foundation

Core architecture. No user-facing features beyond scaffold.

- Monorepo layout (`packages/core`, `packages/db`, app shell)
- Vault filesystem layout (`vaults/{id}/items/{id}/item.json`, `media/`)
- SQLite schema: users, vaults, items, tags, collections, media, source_refs
- Migrations (Drizzle or sql files)
- Core vault operations: open, create, list, sync index from files
- Tauri plugins: `fs`, `sql`; typed IPC bridge to renderer

**Exit criteria:** can create a vault folder, write an item to disk, see it in SQLite index via dev tooling.

---

## M1 — Shell & Users

Local multi-user (profiles on one machine), app chrome.

- User model: register, login, password hash (argon2), switch user
- Login / register UI
- App layout: sidebar, header, main outlet
- React Router + URL query params for filters
- Settings: theme (light/dark), default vault, data directory

**Exit criteria:** two local users, each with isolated vaults; basic navigation works.

---

## M2 — Content Core

Main product value — browse and manage saved content.

- ContentItem CRUD (all types: article, video, image, note, bookmark, pdf, audio)
- Tags (per vault, M2M)
- Collections (tree via `parent_id`, M2M)
- Media attach/detach, stored under item folder
- Thumbnail generation for images/video frames
- Favorite / archive flags
- FTS5 full-text search (title, description, content)
- Dashboard: masonry grid (TeaserCard)
- Dashboard: table view toggle
- Item detail page (metadata, media gallery, markdown content)
- Sidebar: All / Favorites / Archive / by tag / by collection

**Exit criteria:** full content lifecycle in UI; search and filters work on 1000+ items.

---

## M3 — Capture & Portability

Getting data in and moving vaults between machines.

- Drag-and-drop files → new ContentItem
- Manual create: note, bookmark (form)
- URL capture: fetch metadata, optional HTML/readability snapshot
- Export vault as zip (files + manifest)
- Import vault from zip
- Reindex / repair: rebuild SQLite from filesystem

**Exit criteria:** vault backup/restore works; drop a folder of images → items appear.

---

## M4 — Sync Plugins

External sources as isolated plugins. Core stays unaware of specific services.

- Plugin API: `SyncPlugin` interface, `NormalizedItem`, cursor-based pull
- Plugin registry and loader (workspace packages or dynamic import)
- Credential storage: OS keychain (Stronghold / keyring plugin)
- Background sync scheduler (interval + manual trigger)
- Plugin: Reddit saved posts
- Plugin: Telegram (export or user-session pull)
- Plugin: Pinterest boards/pins

**Exit criteria:** install plugin, authenticate, pull items into vault idempotently via `source_refs`.

---

## M5 — Polish & Release

Production readiness.

- Video / audio inline preview
- PDF preview (pdf.js)
- Markdown + GFM rendering for notes/articles
- Migration tool from legacy Django `collector.tools` (Postgres → vault zip)
- GitHub Actions: build Linux, macOS, Windows
- Tauri auto-updater
- Optional: vault encryption at rest (SQLCipher or file-level)

**Exit criteria:** installable binaries for three platforms; legacy data migrates cleanly.

---

## Architecture notes

### Source of truth

Files on disk. SQLite is an index (search, filters, joins). Reindex recovers from corruption.

### Multi-user

Local accounts, not network auth. Each user has own vaults under `{dataDir}/users/{userId}/`.

### Plugins

Never import Telegram/Reddit logic into core. Plugins emit `NormalizedItem`; core runs import pipeline.

---

## Issue tracker

All features are tracked as GitHub Issues assigned to milestones:
https://github.com/pamnard/collector/issues
