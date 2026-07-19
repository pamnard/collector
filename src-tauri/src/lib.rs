mod vault_fs;
mod vault_watcher;
pub mod service_ipc;
pub mod service_lock;
pub mod service_logs;
pub mod service_mode;
pub mod service_supervise;

use service_ipc::{ServiceIpcClient, ServiceIpcState};
use service_mode::{service_mode_enabled, NodeHostSupervisor, SERVICE_MODE_ENV};
use service_supervise::{supervise_enabled, ServiceSupervisor, SUPERVISE_ENABLE_ENV};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
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

struct ServiceModeState {
    host: Mutex<Option<NodeHostSupervisor>>,
}

fn resolve_sidecar_bin(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let exe = app
        .path()
        .executable_dir()
        .map_err(|e| format!("executable_dir: {e}"))?;
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
fn service_mode_is_enabled() -> bool {
    service_mode_enabled()
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

/// Boot Node host + dial IPC (#170). Idempotent while host stays up.
#[tauri::command]
fn service_mode_bootstrap(
    mode_state: tauri::State<'_, ServiceModeState>,
    ipc_state: tauri::State<'_, ServiceIpcState>,
    data_dir: String,
) -> Result<String, String> {
    if !service_mode_enabled() {
        return Err(format!(
            "service mode disabled (set {SERVICE_MODE_ENV}=1 to enable cutover)"
        ));
    }
    let data_dir = PathBuf::from(data_dir);

    {
        let mut host_guard = mode_state.host.lock().map_err(|e| e.to_string())?;
        let need_spawn = match host_guard.as_mut() {
            Some(h) => !h.is_running().unwrap_or(false),
            None => true,
        };
        if need_spawn {
            let host = NodeHostSupervisor::spawn(&data_dir).map_err(|e| e.to_string())?;
            *host_guard = Some(host);
        }
        let host = host_guard.as_ref().ok_or("service host missing")?;
        let ipc_path = host.ipc_path.clone();
        *ipc_state.ipc_path.lock().map_err(|e| e.to_string())? = Some(ipc_path.clone());

        let mut client_guard = ipc_state.client.lock().map_err(|e| e.to_string())?;
        if client_guard.is_none() {
            let client = ServiceIpcClient::connect(&ipc_path, Duration::from_secs(15))
                .map_err(|e| e.to_string())?;
            *client_guard = Some(Arc::new(client));
        }
        Ok(ipc_path.to_string_lossy().into_owned())
    }
}

#[tauri::command]
fn service_ipc_request(
    ipc_state: tauri::State<'_, ServiceIpcState>,
    method: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let guard = ipc_state.client.lock().map_err(|e| e.to_string())?;
    let client = guard.as_ref().ok_or("service IPC not connected (call service_mode_bootstrap)")?;
    client.request(&method, params).map_err(|e| e.to_string())
}

#[tauri::command]
fn service_mode_stop(
    mode_state: tauri::State<'_, ServiceModeState>,
    ipc_state: tauri::State<'_, ServiceIpcState>,
) -> Result<(), String> {
    if let Some(client) = ipc_state.client.lock().map_err(|e| e.to_string())?.take() {
        let _ = client.close();
    }
    *ipc_state.ipc_path.lock().map_err(|e| e.to_string())? = None;
    let mut host_guard = mode_state.host.lock().map_err(|e| e.to_string())?;
    if let Some(mut host) = host_guard.take() {
        host.stop(Duration::from_secs(5)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Default path: service mode OFF → in-process LocalAdapter (no dual writer).
    // Cutover: COLLECTOR_SERVICE_MODE=1 → Node host + IPC via service_mode_bootstrap.
    tauri::Builder::default()
        .manage(VaultWatcherState::new())
        .manage(ServiceSuperviseState {
            supervisor: Mutex::new(None),
        })
        .manage(ServiceModeState {
            host: Mutex::new(None),
        })
        .manage(ServiceIpcState::new())
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
            service_mode_is_enabled,
            service_mode_bootstrap,
            service_mode_stop,
            service_ipc_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
