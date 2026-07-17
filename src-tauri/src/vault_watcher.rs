use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const WATCH_EVENT: &str = "vault-item-fs-change";
const WATCH_ERROR_EVENT: &str = "vault-items-watcher-error";

/// Raw filesystem change under the vault root. Path-to-item-id resolution
/// (including `*.media/` sidecar → sibling `.md` mapping) happens on the TS
/// side via `parseVaultItemWatchPath` (`packages/core/src/vault/vault-watch-path.ts`),
/// so this stays a dumb forwarder of whatever `notify` reports.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultItemFsChange {
    vault_path: String,
    changed_path: String,
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

#[tauri::command]
pub fn start_vault_items_watcher(
    app: AppHandle,
    state: State<'_, VaultWatcherState>,
    vault_path: String,
) -> Result<(), String> {
    let root = Path::new(&vault_path);
    if !root.is_dir() {
        return Err(format!("vault directory missing: {}", root.display()));
    }

    let mut watchers = state.watchers.lock().map_err(|error| error.to_string())?;
    if watchers.contains_key(&vault_path) {
        return Ok(());
    }

    let vault_path_for_emit = vault_path.clone();
    let app_handle = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            match result {
                Ok(event) => {
                    for path in event.paths {
                        let _ = app_handle.emit(
                            WATCH_EVENT,
                            VaultItemFsChange {
                                vault_path: vault_path_for_emit.clone(),
                                changed_path: path.to_string_lossy().into_owned(),
                            },
                        );
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
        .watch(root, RecursiveMode::Recursive)
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
