---
name: collector-vault
description: >-
  Operate a living Collector vault via MCP tools or collector-cli (same host RPC).
  Use when searching, creating, updating, moving, or deleting items; managing
  folders, tags, or media; or when the user mentions Collector, collector_search,
  collector-cli, vault items, path-as-id, or item media/covers.
license: MIT
compatibility: Requires a running Collector domain host. Prefer MCP when available; otherwise collector-cli with --base-url and --data-dir (or host token).
metadata:
  author: collector
  surface: mcp-cli
---

# Collector vault operations

MCP (`collector_*` tools) and CLI (`collector-cli <command>`) are **thin clients of the same living host**. They do not open the vault or SQLite themselves.

Do **not** create, edit, or delete vault `.md` files, `*.media/` sidecars, or `collector.db` on disk. Always go through MCP or CLI.

Param-level API truth lives in the product tool catalog (`packages/mcp/src/tools-catalog.ts`) and CLI help — not in this skill. For the command map see [references/mcp-cli-map.md](references/mcp-cli-map.md). For common agent mistakes see [references/pitfalls.md](references/pitfalls.md).

## When to use which channel

| Channel | Use when |
|---------|----------|
| **MCP** | Editor/agent has Collector MCP connected (preferred for interactive work) |
| **CLI** | Scripts, shell-only sessions, or MCP unavailable |

Same operations, same host, same `itemId` rules. Pick one channel per task; do not mix half-finished state across channels without re-reading ids.

CLI needs a live host and dial flags (from the host READY line / data dir), for example:

```bash
collector-cli --base-url http://127.0.0.1:PORT --data-dir /path/to/vault-data <command> …
```

## Preconditions

1. Host is running (UI or `./collector` / service serve).
2. Call **health** first (`collector_health` or `collector-cli … health`). Proceed only when the vault/index is usable (`ok` and `healthy`).
3. Keep every `itemId` as the **full vault-relative `.md` path** returned by create/search/get/move (e.g. `Inbox/a1b2c3….md`). Never truncate to a bare UUID or filename stem.

## Domain model (agent-facing)

- **Item** — one vault-relative `.md` path (path-as-id). Metadata in YAML frontmatter; body is markdown.
- **Folder** — filesystem folder; empty / omitted create destination → **Inbox**.
- **Tag** — named label; delete uses opaque **UUID** `tagId`, not a path. Do not confuse with `itemId`.
- **Media** — attachments via list/attach/replace/delete/set-cover tools. Cover auto-syncs after attach/delete/replace; set-cover only when picking a specific image/video.

## Preferred workflows

### Find then act

1. `search` with a text query (title/body/frontmatter FTS) — **not** an id/path lookup.
2. Take `id` from each hit **unchanged** as `itemId`.
3. `get-item` when you need metadata + body; `get-item-source` only for full raw document round-trips.

### Create

1. `create-item` with at least `title` (CLI: `--title`).
2. Optional: type, description, url, content, folder.
3. Store returned `id` for all later calls.

When creating or filling an item (especially imports), **prefer also setting a short `description` and relevant `tags`** when you can derive them from the content or user intent — empty description/tags are weaker for search and browsing.

### Update fields

Prefer **structured** update (`collector_update_item` / `update-item`) for title, description, url, content, content_type, tags, folder.

Use **source** get/update only when replacing the entire `.md` (frontmatter + body) as one document.

### Article / imported body

When filling `content` from a web article (or similar):

- Put the canonical link in the item **`url`** field (frontmatter), not as a “Source: …” / byline block at the **top** of the body.
- Body must start with the article body itself — not duplicated metadata, not a second frontmatter block, not breadcrumbs, nav, share widgets, subscribe blocks, related-post lists, or footer chrome from the source page.
- Do **not** duplicate the article title at the top of `content` when the item already has a `title` field. Keep the title in the item metadata; only include an in-body H1 if the user explicitly asked to preserve the page heading in the markdown body.
- Preserve hyperlinks from the source page inside the markdown body:
  - Keep absolute `http://...` and `https://...` links as web URLs.
  - Do not rewrite them into local vault-style `(... .md)` links (or internal nodes) unless the user explicitly asked for internal/wikilink conversion and we can map targets.
- Do **not** invent a provenance header. If the user asks for an explicit source line, put it at the **bottom** of the body — never at the top.

### Import: local assets

When importing a page, article, or other remote content into an item, **bring related assets (images, other fetchable binaries) into local item media**: download → `attach-media` / `collector_attach_media` → reference the attached files in the markdown body. The vault is meant to work offline; leaving body images on a third-party CDN is not acceptable.

**If one download method fails — do not stop.** Try alternatives in order:
1. Shell download (`curl`, `wget`)
2. `WebFetch` to retrieve the binary or locate the direct URL
3. `collector_attach_media` with `dataBase64` (fetch raw bytes, base64-encode, pass inline)

A tool/environment block on one path is not a reason to skip images entirely. Only stop after exhausting all viable paths, and if still blocked — explicitly report what was tried and what remains for the user to do manually. Never silently record `image count = 0` and treat the import as complete.

### Move

`move-item` (or update with folder) changes the path. Response includes the **new** `itemId` — discard the old path for subsequent calls.

### Media

1. `list-item-media` → use media `id` (UUID) for replace/delete/set-cover.
2. Attach via host-readable `sourcePath` / CLI `--file`, or MCP `dataBase64` (+ `filename` when base64).
3. Do not invent sidecar paths or write into `*.media/` yourself.

### Folders

List → create / rename / move / delete. **Delete folder is recursive** (tree + all items + media under that prefix). Confirm intent before calling.

### Tags

`create-tag` returns UUID `id` for `delete-tag`. Assigning tags on an item is done via item update (`tags` names) or source frontmatter — not by inventing tag paths.

## Anti-patterns

- Editing vault files or SQLite directly
- Using `search` with a UUID/path expecting id lookup
- Truncating `Inbox/<uuid>.md` to `<uuid>` or `<uuid>.md`
- Reusing pre-move `itemId` after a successful move
- Passing `itemId` where `tagId` / `mediaId` is required (or the reverse)
- Preferring source rewrite for a single field change
- Prefacing imported article body with `Source:`, byline, or duplicated original URL (belongs in `url`, or at bottom only if asked)
- Duplicating the article title as the first line / H1 in `content` when the item `title` already stores it
- Preserving source-site scaffolding instead of article content: duplicate frontmatter, breadcrumbs, nav menus, share controls, subscribe prompts, related-article rails, footer chrome
- Rewriting source-page web links into local `(... .md)` links or vault-internal nodes without an explicit user request

Details and edge cases: [references/pitfalls.md](references/pitfalls.md).

## After mutations

Re-read with `get-item` (or list media) when the next step depends on new ids, cover, or tags. Failures from the host are authoritative — fix arguments; do not bypass via the filesystem.
