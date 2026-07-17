use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const ITEMS_DIR: &str = "items";
const RECONCILE_TOUCH: &str = ".collector-touch";
const WATCH_EVENT: &str = "vault-item-fs-change";
const WATCH_ERROR_EVENT: &str = "vault-items-watcher-error";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultItemFsChange {
    vault_path: String,
    item_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultWatcherErrorPayload {
    vault_path: String,
    message: String,
}

struct WatcherGuard {
    _watcher: RecommendedWatcher,
}

pub struct VaultWatcherState {
    watchers: Mutex<HashMap<String, WatcherGuard>>,
}

impl VaultWatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

fn items_dir(vault_path: &str) -> PathBuf {
    Path::new(vault_path).join(ITEMS_DIR)
}

fn parse_item_id(items_dir: &Path, event_path: &Path) -> Option<String> {
    let relative = event_path.strip_prefix(items_dir).ok()?;
    let item_id = relative
        .components()
        .next()?
        .as_os_str()
        .to_string_lossy()
        .into_owned();
    if item_id.is_empty() || item_id == RECONCILE_TOUCH {
        return None;
    }
    Some(item_id)
}

#[tauri::command]
pub fn start_vault_items_watcher(
    app: AppHandle,
    state: State<'_, VaultWatcherState>,
    vault_path: String,
) -> Result<(), String> {
    let items = items_dir(&vault_path);
    if !items.is_dir() {
        return Err(format!("items directory missing: {}", items.display()));
    }

    let mut watchers = state.watchers.lock().map_err(|error| error.to_string())?;
    if watchers.contains_key(&vault_path) {
        return Ok(());
    }

    let vault_path_for_emit = vault_path.clone();
    let app_handle = app.clone();
    let items_for_watch = items.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            match result {
                Ok(event) => {
                    for path in event.paths {
                        if let Some(item_id) = parse_item_id(&items_for_watch, &path) {
                            let _ = app_handle.emit(
                                WATCH_EVENT,
                                VaultItemFsChange {
                                    vault_path: vault_path_for_emit.clone(),
                                    item_id,
                                },
                            );
                        }
                    }
                }
                Err(error) => {
                    let _ = app_handle.emit(
                        WATCH_ERROR_EVENT,
                        VaultWatcherErrorPayload {
                            vault_path: vault_path_for_emit.clone(),
                            message: error.to_string(),
                        },
                    );
                }
            }
        },
        Config::default().with_poll_interval(Duration::from_secs(2)),
    )
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&items, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;

    watchers.insert(
        vault_path,
        WatcherGuard {
            _watcher: watcher,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn stop_vault_items_watcher(
    state: State<'_, VaultWatcherState>,
    vault_path: String,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().map_err(|error| error.to_string())?;
    watchers.remove(&vault_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_item_id;
    use std::path::Path;

    #[test]
    fn parse_item_id_from_nested_path() {
        let items = Path::new("/vault/items");
        assert_eq!(
            parse_item_id(items, Path::new("/vault/items/abc/content.md")).as_deref(),
            Some("abc")
        );
        assert_eq!(
            parse_item_id(items, Path::new("/vault/items/.collector-touch")).as_deref(),
            None
        );
    }
}
