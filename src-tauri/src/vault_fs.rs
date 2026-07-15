use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const ITEMS_DIR: &str = "items";
const ITEM_META_FILE: &str = "item.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultItemStatMeta {
    pub id: String,
    pub mtime_ms: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultItemMetaRead {
    pub id: String,
    pub item_json: String,
}

fn items_dir(vault_path: &str) -> PathBuf {
    Path::new(vault_path).join(ITEMS_DIR)
}

fn item_meta_path(items_dir: &Path, item_id: &str) -> PathBuf {
    items_dir.join(item_id).join(ITEM_META_FILE)
}

fn mtime_ms(path: &Path) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

#[tauri::command]
pub fn vault_items_stat_meta(vault_path: String) -> Result<Vec<VaultItemStatMeta>, String> {
    let items_dir = items_dir(&vault_path);
    if !items_dir.is_dir() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&items_dir).map_err(|error| error.to_string())?;
    let mut results = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            continue;
        }

        let id = entry.file_name().to_string_lossy().into_owned();
        let meta_path = item_meta_path(&items_dir, &id);
        let mtime_ms = if meta_path.is_file() {
            mtime_ms(&meta_path)
        } else {
            None
        };

        results.push(VaultItemStatMeta { id, mtime_ms });
    }

    Ok(results)
}

#[tauri::command]
pub fn vault_items_read_meta(
    vault_path: String,
    ids: Vec<String>,
) -> Result<Vec<VaultItemMetaRead>, String> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    let items_dir = items_dir(&vault_path);
    let mut results = Vec::with_capacity(ids.len());

    for id in ids {
        let meta_path = item_meta_path(&items_dir, &id);
        if !meta_path.is_file() {
            continue;
        }

        let item_json =
            fs::read_to_string(&meta_path).map_err(|error| format!("{id}: {error}"))?;
        results.push(VaultItemMetaRead { id, item_json });
    }

    Ok(results)
}
