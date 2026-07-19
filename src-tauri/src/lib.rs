mod vault_fs;
mod vault_watcher;
pub mod service_domain_host;
pub mod service_lock;
pub mod service_logs;
pub mod service_supervise;

use service_supervise::{supervise_enabled, ServiceSupervisor, SUPERVISE_ENABLE_ENV};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use vault_fs::{
    fs_touch, fs_write_text_exclusive, resolve_item_thumbnail_paths, vault_items_read_meta,
    vault_items_read_source_refs, vault_items_stat_meta,
};
use vault_watcher::{
    start_vault_items_watcher, stop_vault_items_watcher, VaultWatcherState,
};

struct ServiceSuperviseState {
    supervisor: Mutex<Option<ServiceSupervisor>>,
}

fn resolve_sidecar_bin(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let exe = app
        .path()
        .executable_dir()
        .map_err(|e| format!("executable_dir: {e}"))?;
    // Packaged: sidecar sits next to the app binary as collector-service.
    // Dev: fall back to src-tauri/binaries/collector-service-$triple from prepare script.
    let packaged = exe.join("collector-service");
    if packaged.is_file() {
        return Ok(packaged);
    }
    #[cfg(windows)]
    {
        let packaged_exe = exe.join("collector-service.exe");
        if packaged_exe.is_file() {
            return Ok(packaged_exe);
        }
    }
    let triple = std::env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| {
            std::process::Command::new("rustc")
                .args(["--print", "host-tuple"])
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .ok_or_else(|| "host triple".to_string())
        })
        .map_err(|e| e.to_string())?;
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("collector-service-{triple}"));
    if dev.is_file() {
        return Ok(dev);
    }
    Err(format!(
        "collector-service sidecar not found (packaged next to app or at {})",
        dev.display()
    ))
}

#[tauri::command]
fn service_supervise_is_enabled() -> bool {
    supervise_enabled()
}

#[tauri::command]
fn service_supervise_spawn(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceSuperviseState>,
    data_dir: String,
) -> Result<u32, String> {
    if !supervise_enabled() {
        return Err(format!(
            "service supervise disabled (set {SUPERVISE_ENABLE_ENV}=1)"
        ));
    }
    let sidecar = resolve_sidecar_bin(&app)?;
    let mut guard = state.supervisor.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.as_mut() {
        if existing.is_running().unwrap_or(false) {
            return Ok(existing.pid());
        }
    }
    let sup = ServiceSupervisor::spawn(&sidecar, PathBuf::from(data_dir).as_path())
        .map_err(|e| e.to_string())?;
    let pid = sup.pid();
    *guard = Some(sup);
    Ok(pid)
}

#[tauri::command]
fn service_supervise_stop(
    state: tauri::State<'_, ServiceSuperviseState>,
) -> Result<(), String> {
    let mut guard = state.supervisor.lock().map_err(|e| e.to_string())?;
    let Some(sup) = guard.as_mut() else {
        return Ok(());
    };
    sup.stop(Duration::from_secs(5)).map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[tauri::command]
fn service_supervise_kill(
    state: tauri::State<'_, ServiceSuperviseState>,
) -> Result<(), String> {
    let mut guard = state.supervisor.lock().map_err(|e| e.to_string())?;
    let Some(sup) = guard.as_mut() else {
        return Ok(());
    };
    sup.kill().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Default path: never spawn the service sidecar (flag OFF → no dual writer).
    tauri::Builder::default()
        .manage(VaultWatcherState::new())
        .manage(ServiceSuperviseState {
            supervisor: Mutex::new(None),
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            vault_items_stat_meta,
            vault_items_read_meta,
            vault_items_read_source_refs,
            resolve_item_thumbnail_paths,
            fs_touch,
            fs_write_text_exclusive,
            start_vault_items_watcher,
            stop_vault_items_watcher,
            service_supervise_is_enabled,
            service_supervise_spawn,
            service_supervise_stop,
            service_supervise_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
