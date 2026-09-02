# MCP ↔ CLI map

Same host RPC. Prefer tool/CLI descriptions for parameters; this table is only the name mapping.

CLI always needs dial flags before the subcommand: `--base-url … --data-dir …` (or equivalent token env).

| Operation | MCP tool | CLI command |
|-----------|----------|-------------|
| Health | `collector_health` | `health` |
| Search (FTS) | `collector_search` | `search <query>` |
| Get item | `collector_get_item` | `get-item <item-id>` |
| Get raw `.md` | `collector_get_item_source` | `get-item-source <item-id>` |
| Create item | `collector_create_item` | `create-item --title …` |
| Update fields | `collector_update_item` | `update-item <item-id> [--title …] …` |
| Replace raw `.md` | `collector_update_item_source` | `update-item-source <item-id> --content …` |
| Wait derived (opt-in) | `collector_wait_derived` | `wait-derived <item-id> --revision <n>` |
| Delete item | `collector_delete_item` | `delete-item <item-id>` |
| Move item | `collector_move_item` | `move-item <item-id> --folder …` |
| Create folder | `collector_create_folder` | `create-folder <path>` |
| List folders | `collector_list_folders` | `list-folders` |
| List folder items | `collector_list_folder_items` | `list-folder-items <path> [--sort …] [--dir …]` |
| Rename folder | `collector_rename_folder` | `rename-folder <old> <new>` |
| Move folder | `collector_move_folder` | `move-folder <old> <new>` |
| Delete folder | `collector_delete_folder` | `delete-folder <path>` |
| List media | `collector_list_item_media` | `list-item-media <item-id>` |
| Attach media | `collector_attach_media` | `attach-media <item-id> --file <path>` |
| Replace media | `collector_replace_media` | `replace-media <item-id> <media-id> --file <path>` |
| Delete media | `collector_delete_media` | `delete-media <item-id> <media-id>` |
| Set cover | `collector_set_item_cover` | `set-item-cover <item-id> <media-id>` |
| Discover extract candidates (host plugins only) | `collector_discover_extract_candidates` | `discover-extract-candidates <item-id>` |
| Run extract candidate (host plugins only) | `collector_extract_item_candidate` | `extract-item-candidate <item-id> --extractor-id … --url …` |

Extract rows are **not** general web import. Ordinary “URL → note body” is fetch + `update-item` / `collector_update_item`.

## Flag notes (CLI)

- Create/update type: `--type` (MCP: `content_type`).
- Folder on create/update/move: `--folder` (MCP: `folder_path` / `folderPath`).
- Tags on update: `--tags name1,name2` (MCP: `tags` string array). This is how tags enter the catalog — there is no create-tag / delete-tag command.
- Attach/replace file: `--file` (MCP: `sourcePath` or `dataBase64`).
- Source replace body: `--content` holds the full raw markdown document.
- Folder item list sort: `--sort` + `--dir` together (MCP: `sortKey` + `sortDir`).
  Keys: `title`, `created_at`, `updated_at`, `content_type`, `word_count`,
  `character_count`. Dirs: `asc`|`desc`. Omit both → `created_at` desc.

If a command is missing here, trust the installed binary / MCP catalog over this file.
