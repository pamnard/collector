# Pitfalls

## Identifiers

| Kind | Shape | Wrong |
|------|--------|--------|
| `itemId` | Vault-relative path ending in `.md` (e.g. `Inbox/….md`) | Bare UUID, stem without folder, path without `.md` |
| `tagId` | Opaque UUID from create/list tag | Item path, tag display name |
| `mediaId` | Opaque UUID from list/attach media | Filename, sidecar relative path |

After `move-item` / update-with-folder, the item path changes. Use the **new** `itemId` from the response.

## Search

`search` / `collector_search` is full-text over note text (and title/description columns). It is **not** lookup by id or path. Searching a UUID or `Inbox/foo.md` will not reliably return that item by identity.

To open a known path: `get-item` / `get-item-source` with that full path.

## Sole writer

Only the domain host mutates the vault and index. MCP and CLI talk to that host over HTTP. Parallel hosts on the same data-dir fail; do not “fix” lock issues by editing files under the vault.

## Structured vs source

- One or few fields → structured update.
- Whole-document edit (frontmatter + body as one blob) → get-source then update-source.
- Do not rewrite source to change a single title if structured update is available.

## Media layout

Sidecar directories (`*.media/`) are host-owned. Attach/replace/delete/set-cover keep layout and cover sync consistent. Manual copies into sidecars desync the index and covers.

## Destructive folder delete

`delete-folder` removes the folder tree and **every item** under that prefix (markdown + media + index rows). Not an empty-directory rmdir.
