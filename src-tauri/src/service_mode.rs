//! Service-mode cutover (#170 / epic #142).
//!
//! Default ON for the desktop app. Opt out with `COLLECTOR_SERVICE_MODE=0`.
//! Spawns the supervised domain host with the canonical profile layout and
//! returns the IPC path for the WebView transport (#239).

use crate::service_supervise::{
    supervise_enabled, ServiceSupervisor, SUPERVISE_ENABLE_ENV,
};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const SERVICE_MODE_ENV: &str = "COLLECTOR_SERVICE_MODE";

/// Default-on cutover; explicit `0`/`false`/`no`/`off` disables.
pub fn service_mode_enabled() -> bool {
    match std::env::var(SERVICE_MODE_ENV) {
        Ok(value) => {
            let v = value.trim();
            !matches!(
                v,
                "0" | "false" | "FALSE" | "no" | "NO" | "off" | "OFF"
            )
        }
        Err(_) => true,
    }
}

/// Ensure supervise gate is unlocked for cutover spawn.
fn ensure_supervise_unlocked() {
    if !supervise_enabled() {
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
    }
}

pub fn bootstrap_service_mode(
    sidecar_bin: &Path,
    data_dir: &Path,
    config_dir: &Path,
    supervisor: &mut Option<ServiceSupervisor>,
) -> Result<PathBuf, String> {
    if !service_mode_enabled() {
        return Err(format!(
            "service mode disabled (set {SERVICE_MODE_ENV}=1 or unset it)"
        ));
    }
    ensure_supervise_unlocked();
    if let Some(existing) = supervisor.as_mut() {
        if existing.is_running().unwrap_or(false) {
            return existing
                .wait_for_ready_ipc_path(Duration::from_secs(20))
                .map_err(|e| e.to_string());
        }
    }
    let sup = ServiceSupervisor::spawn(sidecar_bin, data_dir, Some(config_dir))
        .map_err(|e| e.to_string())?;
    let ipc_path = sup
        .wait_for_ready_ipc_path(Duration::from_secs(30))
        .map_err(|e| e.to_string())?;
    *supervisor = Some(sup);
    Ok(ipc_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_enabled_when_env_unset() {
        std::env::remove_var(SERVICE_MODE_ENV);
        assert!(service_mode_enabled());
    }

    #[test]
    fn disabled_when_env_zero() {
        std::env::set_var(SERVICE_MODE_ENV, "0");
        assert!(!service_mode_enabled());
        std::env::remove_var(SERVICE_MODE_ENV);
    }

    #[test]
    fn bootstrap_spawns_live_host_and_returns_ipc_path() {
        use crate::service_ipc::ServiceIpcClient;
        use crate::service_supervise::SUPERVISE_ENABLE_ENV;
        use std::process::Command;

        let triple = {
            let out = Command::new("rustc")
                .args(["--print", "host-tuple"])
                .output()
                .expect("rustc");
            String::from_utf8(out.stdout).expect("utf8").trim().to_string()
        };
        let sidecar = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("binaries/collector-service-{triple}"));
        if !sidecar.is_file() {
            eprintln!("skip: missing sidecar {}", sidecar.display());
            return;
        }
        std::env::remove_var(SERVICE_MODE_ENV);
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
        let root = std::env::temp_dir().join(format!(
            "collector-mode-boot-{}",
            std::process::id()
        ));
        let data_dir = root.join("share/collector");
        let config_dir = root.join("config/collector");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&config_dir).unwrap();
        let mut holder = None;
        let ipc = bootstrap_service_mode(&sidecar, &data_dir, &config_dir, &mut holder)
            .expect("bootstrap");
        let client = ServiceIpcClient::connect(&ipc, Duration::from_secs(5)).expect("connect");
        let ping = client.request("ping", None).expect("ping");
        assert_eq!(ping.get("ok"), Some(&serde_json::json!(true)));
        let data = client.request("getDataDirectory", None).expect("dataDir");
        assert_eq!(
            data.as_str().map(str::to_string),
            Some(data_dir.to_string_lossy().into_owned())
        );
        let index_at_config_parent = config_dir
            .parent()
            .map(|p| p.join("collector.db"))
            .filter(|p| p.is_file());
        assert!(
            data_dir.join("collector.db").is_file() || index_at_config_parent.is_some(),
            "expected index DB under layout"
        );
        if let Some(mut sup) = holder.take() {
            let _ = sup.stop(Duration::from_secs(10));
        }
        let _ = client.close();
        let _ = std::fs::remove_dir_all(root);
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
    }
}
