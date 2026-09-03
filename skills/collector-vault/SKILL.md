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

Param-level API truth lives in the product tool catalog (`packages/mcp/src/tools-catalog.ts`) and CLI help — not in this skill. For the command map see [references/mcp-cli-map.md](references/mcp-cli-map.md). For common agent mistakes see [references/pitfalls.md](references/pitfalls.md). For article-import rules see [references/import-rules.md](references/import-rules.md).

## When to use which channel

| Channel | Use when                                                                  |
| ------- | ------------------------------------------------------------------------- |
| **MCP** | Editor/agent has Collector MCP connected (preferred for interactive work) |
| **CLI** | Scripts, shell-only sessions, or MCP unavailable                          |

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
- **Tag** — named label that appears because it is assigned on documents (frontmatter / item update). Catalog lists are derived from documents; there is no create/delete tag catalog command. Do not confuse tag names with `itemId`.
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

When the user wants the contents of a normal web link in a note (any site that is not covered below — Reddit, blogs, news, docs, etc.):

1. Open/download the page yourself.
2. Put the article into the note with `update-item` / `collector_update_item`.
3. Follow [references/import-rules.md](references/import-rules.md).

Do **not** start with `discover-extract-candidates` / `collector_discover_extract_candidates` for that. Those tools are only for the few sites listed in the next section.

Minimal invariant in the main skill:

- canonical source URL belongs in item `url`
- body starts with article content, not source-site chrome
- do not duplicate the article title in `content`
- preserve useful links as working links

### Site-specific extract tools (Instagram, Pinterest, YouTube)

Collector has a separate pair of tools that only know a few sites (**Instagram**, **Pinterest**, **YouTube**):

- `discover-extract-candidates` / `collector_discover_extract_candidates` — looks in the note for links those tools understand
- `extract-item-candidate` / `collector_extract_item_candidate` — pulls that site’s content into the note

Use them **only** for those sites (or when discover actually returns a match). If discover returns an empty list, ignore these tools and import the page yourself as above. Do not talk about these tools to the user when they do not apply.

**YouTube:** extract uses the bundled `yt-dlp` and reads **Chrome/Chromium cookies** from the machine (YouTube login session) to pass bot checks. Override browser/profile with `COLLECTOR_YT_COOKIES_BROWSER` (e.g. `chrome:Profile 3`) when needed. Do not log cookie contents.

### Import: local assets

For asset-localisation rules and fallback order, follow [references/import-rules.md](references/import-rules.md).

### Move

`move-item` (or update with folder) changes the path. Response includes the **new** `itemId` — discard the old path for subsequent calls.

### Media

1. `list-item-media` → use media `id` (UUID) for replace/delete/set-cover.
2. Attach via host-readable `sourcePath` / CLI `--file`, or MCP `dataBase64` (+ `filename` when base64).
3. Do not invent sidecar paths or write into `*.media/` yourself.

### Folders

List tree → list items in a folder → create / rename / move / delete.
`list-folder-items` / `collector_list_folder_items` uses **exact** `folder_path`
membership (no child folders). Empty folder → `[]`; missing folder fails.
Optional sort (`--sort` / `--dir`, MCP `sortKey` / `sortDir`): keys
`title`, `created_at`, `updated_at`, `content_type`, `word_count`,
`character_count`; dirs `asc`|`desc`. Omit both → default `created_at` desc.
Pass key and direction together.
**Delete folder is recursive** (tree + all items + media under that prefix). Confirm intent before calling.

### Tags

Assign tag **names** on an item via structured update (`tags`) or source frontmatter. Aggregated tag lists (sidebar / picker) show only names that currently appear on documents — never create or delete catalog entries independently.

## Anti-patterns

- Editing vault files or SQLite directly
- Using `search` with a UUID/path expecting id lookup
- Truncating `Inbox/<uuid>.md` to `<uuid>` or `<uuid>.md`
- Reusing pre-move `itemId` after a successful move
- Passing `itemId` where `mediaId` is required (or the reverse)
- Preferring source rewrite for a single field change
- Calling the Instagram/site-specific extract tools for a normal “put this link into the note” task (Reddit, blogs, etc.) — download the page and use `update-item` instead
- Prefacing imported article body with `Source:`, byline, or duplicated original URL (belongs in `url`, or at bottom only if asked)
- Duplicating the article title as the first line / H1 in `content` when the item `title` already stores it
- Preserving source-site scaffolding instead of article content: duplicate frontmatter, breadcrumbs, nav menus, share controls, subscribe prompts, related-article rails, footer chrome
- Rewriting source-page web links into local `(... .md)` links or vault-internal nodes without an explicit user request

Details and edge cases: [references/pitfalls.md](references/pitfalls.md), [references/import-rules.md](references/import-rules.md).

## After mutations

Re-read with `get-item` (or list media) when the next step depends on new ids, cover, or tags. Failures from the host are authoritative — fix arguments; do not bypass via the filesystem.
