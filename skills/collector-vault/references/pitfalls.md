# Pitfalls

## Identifiers

| Kind | Shape | Wrong |
|------|--------|--------|
| `itemId` | Vault-relative path ending in `.md` (e.g. `Inbox/….md`) | Bare UUID, stem without folder, path without `.md` |
| tag name | Display string on item update / frontmatter; catalogs are derived from documents (#842) | Inventing catalog create/delete APIs, treating names as paths |
| `mediaId` | Opaque UUID from list/attach media | Filename, sidecar relative path |

After `move-item` / update-with-folder, the item path changes. Use the **new** `itemId` from the response.

## Search

`search` / `collector_search` is full-text over note text (and title/description columns). It is **not** lookup by id or path. Searching a UUID or `Inbox/foo.md` will not reliably return that item by identity. Results are page-capped and return `{ items, total, offset }` — when `items.length < total` the page is truncated.

To open a known path: `get-item` / `get-item-source` with that full path.

## Sole writer

Only the domain host mutates the vault and index. MCP and CLI talk to that host over HTTP. Parallel hosts on the same data-dir fail; do not “fix” lock issues by editing files under the vault.

## MCP auth vs Cursor `mcp_auth`

Collector MCP has no `mcp_auth` tool — Cursor may inject that name for its own connect UI. Host auth is the Bearer token from `--data-dir` files (or pinned `--token` / `COLLECTOR_HOST_TOKEN`). Prefer **`--data-dir` only** in MCP config so a host restart (new token file) is picked up on the next tool call. A successful Cursor `mcp_auth` does not prove host Bearer is valid; use `collector_health`.

## Structured vs source

- One or few fields → structured update.
- Whole-document edit (frontmatter + body as one blob) → get-source then update-source.
- Do not rewrite source to change a single title if structured update is available.

## Provenance in body

Canonical page link → item `url`. Do not open the markdown body with `Source: …`, a byline, or a copy of that URL. Body starts with the content. An explicit source line only when the user asks — and then at the **bottom**, not the top.

## Description and tags

Prefer a short `description` and useful `tags` when creating or enriching an item (imports included), if they can be derived from the content. Helps search and browsing; leaving both empty is a weaker default.

## Import and assets

On import, prefer attaching related assets into the item’s local media and pointing the body at those files. Hotlinking remote image hosts leaves the note dependent on the network.

## Media layout

Sidecar directories (`*.media/`) are host-owned. Attach/replace/delete/set-cover keep layout and cover sync consistent. Manual copies into sidecars desync the index and covers.

## Destructive folder delete

`delete-folder` removes the folder tree and **every item** under that prefix (markdown + media + index rows). Not an empty-directory rmdir.

## List folder items ≠ folder tree

`list-folder-items` / `collector_list_folder_items` lists **items in one folder** (exact `folder_path`). It does not walk children. Use `list-folders` for the tree. Empty folder → `[]`; missing folder fails — do not treat empty as missing.
