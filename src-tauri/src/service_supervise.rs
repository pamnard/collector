//! Service process supervise helpers (#166 / #167 / #168 / #237 / epic #142).
//!
//! Dead by default: [`supervise_enabled`] is false unless
//! `COLLECTOR_ENABLE_SERVICE_SUPERVISE=1`. Callers must check the flag before
//! spawn — the desktop app startup path must not call spawn when disabled
//! (no second SQLite writer / no dual process).
//!
//! [`ServiceSupervisor::spawn_for_service_mode`] skips that env gate (service
//! mode has its own `COLLECTOR_SERVICE_MODE` check) and does not mutate env.
//!
//! Spawn runs orphan cleanup (#167) and refuses when a live lock holder remains.
//! Child stdout/stderr append to `{data-dir}/logs/collector-service.log` (#168).
//! The sidecar launches the real Node domain host (#237); READY includes IPC endpoint.

use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::service_domain_host::{NODE_BIN_ENV, NODE_CLI_ENV};
use crate::service_lock::{cleanup_orphans, CleanupOutcome, SUPERVISOR_PID_ENV};
use crate::service_logs::{
    open_service_log_append, service_log_path, verbose_enabled, VERBOSE_ENV,
};

/// Packaged host runtime paths injected into the sidecar process env.
#[derive(Debug, Clone)]
pub struct PackagedHostRuntime {
    pub node_cli: PathBuf,
    pub node_bin: PathBuf,
}

/// Env flag that unlocks supervise spawn/stop for smokes and future cutover.
pub const SUPERVISE_ENABLE_ENV: &str = "COLLECTOR_ENABLE_SERVICE_SUPERVISE";

pub fn supervise_enabled() -> bool {
    matches!(
        std::env::var(SUPERVISE_ENABLE_ENV).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes")
    )
}

#[derive(Debug)]
pub struct ServiceSupervisor {
    child: Child,
    data_dir: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum SuperviseError {
    #[error(
        "service supervise disabled (set COLLECTOR_ENABLE_SERVICE_SUPERVISE=1 to enable)"
    )]
    Disabled,
    #[error("service lock already held by pid {service_pid}")]
    AlreadyLocked { service_pid: u32 },
    #[error("service supervise I/O: {0}")]
    Io(#[from] io::Error),
    #[error("service process is not running")]
    NotRunning,
    #[error("timed out waiting for service process")]
    TimedOut,
}

impl ServiceSupervisor {
    /// Spawn `collector-service serve --data-dir …`. Refuses when flag is OFF.
    ///
    /// Runs [`cleanup_orphans`] first; a live lock holder blocks spawn.
    pub fn spawn(
        sidecar_bin: &Path,
        data_dir: &Path,
        config_dir: Option<&Path>,
        packaged_host: Option<&PackagedHostRuntime>,
    ) -> Result<Self, SuperviseError> {
        if !supervise_enabled() {
            return Err(SuperviseError::Disabled);
        }
        Self::spawn_inner(sidecar_bin, data_dir, config_dir, packaged_host)
    }

    /// Same as [`Self::spawn`] but skips `COLLECTOR_ENABLE_SERVICE_SUPERVISE`.
    ///
    /// Used by service-mode bootstrap (gated by `COLLECTOR_SERVICE_MODE` instead).
    /// Does not mutate process environment.
    pub fn spawn_for_service_mode(
        sidecar_bin: &Path,
        data_dir: &Path,
        config_dir: Option<&Path>,
        packaged_host: Option<&PackagedHostRuntime>,
    ) -> Result<Self, SuperviseError> {
        Self::spawn_inner(sidecar_bin, data_dir, config_dir, packaged_host)
    }

    fn spawn_inner(
        sidecar_bin: &Path,
        data_dir: &Path,
        config_dir: Option<&Path>,
        packaged_host: Option<&PackagedHostRuntime>,
    ) -> Result<Self, SuperviseError> {
        if !sidecar_bin.is_file() {
            return Err(SuperviseError::Io(io::Error::new(
                io::ErrorKind::NotFound,
                format!("sidecar binary not found: {}", sidecar_bin.display()),
            )));
        }
        std::fs::create_dir_all(data_dir)?;
        match cleanup_orphans(data_dir)? {
            CleanupOutcome::LiveHolder { service_pid, .. } => {
                return Err(SuperviseError::AlreadyLocked { service_pid });
            }
            CleanupOutcome::NoLock
            | CleanupOutcome::RemovedStale
            | CleanupOutcome::CleanedOrphan { .. } => {}
        }
        let (log_path, log_file) = open_service_log_append(data_dir)?;
        let log_file_err = log_file.try_clone()?;
        if verbose_enabled() {
            eprintln!(
                "collector supervise: service log → {} (set {VERBOSE_ENV}=0 to silence)",
                log_path.display()
            );
        }
        let mut cmd = Command::new(sidecar_bin);
        cmd.arg("serve").arg("--data-dir").arg(data_dir);
        if let Some(config_dir) = config_dir {
            cmd.arg("--config-dir").arg(config_dir);
        }
        cmd.env(SUPERVISOR_PID_ENV, std::process::id().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err));
        if verbose_enabled() {
            cmd.env(VERBOSE_ENV, "1");
        }
        if let Some(host) = packaged_host {
            cmd.env(NODE_CLI_ENV, &host.node_cli);
            cmd.env(NODE_BIN_ENV, &host.node_bin);
        }
        let child = cmd.spawn()?;
        Ok(Self {
            child,
            data_dir: data_dir.to_path_buf(),
        })
    }

    pub fn log_path(&self) -> PathBuf {
        service_log_path(&self.data_dir)
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// Block until the service log contains a READY line with `ipcPath`.
    ///
    /// Reads only newly appended bytes (file offset), not the whole log each poll.
    pub fn wait_for_ready_ipc_path(
        &self,
        timeout: Duration,
    ) -> Result<PathBuf, SuperviseError> {
        let log = service_log_path(&self.data_dir);
        let deadline = Instant::now() + timeout;
        let mut offset: u64 = 0;
        let mut carry = String::new();
        loop {
            if log.is_file() {
                let len = std::fs::metadata(&log)?.len();
                if len < offset {
                    offset = 0;
                    carry.clear();
                }
                if len > offset {
                    let mut file = std::fs::File::open(&log)?;
                    file.seek(SeekFrom::Start(offset))?;
                    let mut chunk = String::new();
                    file.read_to_string(&mut chunk)?;
                    offset = len;
                    carry.push_str(&chunk);
                    while let Some(nl) = carry.find('\n') {
                        let line: String = carry.drain(..=nl).collect();
                        let line = line.trim_end_matches(['\r', '\n']);
                        if let Some(path) = crate::service_ipc::parse_ready_ipc_path(line) {
                            return Ok(path);
                        }
                    }
                }
            }
            if Instant::now() >= deadline {
                return Err(SuperviseError::TimedOut);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn is_running(&mut self) -> Result<bool, SuperviseError> {
        match self.child.try_wait()? {
            None => Ok(true),
            Some(_) => Ok(false),
        }
    }

    /// Ask the child to exit (SIGTERM on Unix) and wait up to `timeout`.
    pub fn stop(&mut self, timeout: Duration) -> Result<(), SuperviseError> {
        #[cfg(unix)]
        {
            let pid = self.child.id() as i32;
            // Best-effort SIGTERM of our child; fall through to wait_timeout.
            let _ = libc_kill(pid, 15);
        }
        #[cfg(not(unix))]
        {
            let _ = self.child.kill();
        }
        self.wait_timeout(timeout)
    }

    pub fn kill(&mut self) -> Result<(), SuperviseError> {
        self.child.kill()?;
        let _ = self.child.wait()?;
        Ok(())
    }

    pub fn wait(&mut self) -> Result<std::process::ExitStatus, SuperviseError> {
        Ok(self.child.wait()?)
    }

    fn wait_timeout(&mut self, timeout: Duration) -> Result<(), SuperviseError> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(_status) = self.child.try_wait()? {
                return Ok(());
            }
            if Instant::now() >= deadline {
                self.child.kill()?;
                let _ = self.child.wait()?;
                return Err(SuperviseError::TimedOut);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(unix)]
fn libc_kill(pid: i32, sig: i32) -> i32 {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    // SAFETY: kill(2) on our supervised child pid only.
    unsafe { kill(pid, sig) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    fn sidecar_path() -> PathBuf {
        let triple = crate::host_target_triple().expect("host triple");
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        root.join(format!("binaries/collector-service-{triple}"))
    }

    fn require_sidecar_or_skip(sidecar: &Path) -> bool {
        if sidecar.is_file() {
            return true;
        }
        if std::env::var_os("CI").is_some() {
            panic!(
                "sidecar missing at {} (run prepare:service-sidecar; required under CI)",
                sidecar.display()
            );
        }
        eprintln!(
            "skip: sidecar missing at {} (run prepare:service-sidecar)",
            sidecar.display()
        );
        false
    }

    fn wait_for_ready_log(log: &Path, timeout: Duration) -> String {
        let deadline = Instant::now() + timeout;
        let mut body = String::new();
        while Instant::now() < deadline {
            if log.is_file() {
                body = std::fs::read_to_string(log).unwrap_or_default();
                if body.contains("COLLECTOR_SERVICE_READY ")
                    && body.contains("\"ipcPath\"")
                    && body.contains("\"baseUrl\"")
                {
                    return body;
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        body
    }

    fn parse_ready_base_url(log_body: &str) -> Option<String> {
        for line in log_body.lines() {
            let Some(json) = line.strip_prefix("COLLECTOR_SERVICE_READY ") else {
                continue;
            };
            let value: serde_json::Value = serde_json::from_str(json).ok()?;
            return value
                .get("baseUrl")
                .and_then(|v| v.as_str())
                .map(str::to_string);
        }
        None
    }

    #[test]
    #[serial]
    fn spawn_refuses_when_flag_off() {
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
        let err =
            ServiceSupervisor::spawn(Path::new("/bin/true"), Path::new("/tmp"), None, None)
                .unwrap_err();
        assert!(matches!(err, SuperviseError::Disabled));
    }

    #[test]
    #[serial]
    fn spawn_stop_when_flag_on() {
        let sidecar = sidecar_path();
        if !require_sidecar_or_skip(&sidecar) {
            return;
        }
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
        let dir = std::env::temp_dir().join(format!(
            "collector-supervise-{}",
            std::process::id()
        ));
        let mut sup = ServiceSupervisor::spawn(&sidecar, &dir, None, None).expect("spawn");
        let body = wait_for_ready_log(&sup.log_path(), Duration::from_secs(20));
        assert!(
            body.contains("COLLECTOR_SERVICE_READY ") && body.contains("\"ipcPath\""),
            "expected domain host READY, got: {body:?}"
        );
        assert!(sup.is_running().expect("running"));
        sup.stop(Duration::from_secs(10)).expect("stop");
        assert!(!sup.is_running().expect("stopped check"));
        let _ = std::fs::remove_dir_all(dir);
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
    }

    #[test]
    #[serial]
    fn spawn_refuses_when_live_lock_held() {
        let sidecar = sidecar_path();
        if !require_sidecar_or_skip(&sidecar) {
            return;
        }
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
        let dir = std::env::temp_dir().join(format!(
            "collector-supervise-locked-{}",
            std::process::id()
        ));
        let mut first = ServiceSupervisor::spawn(&sidecar, &dir, None, None).expect("first spawn");
        let _ = wait_for_ready_log(&first.log_path(), Duration::from_secs(20));
        assert!(first.is_running().expect("running"));

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if crate::service_lock::read_lock(&dir)
                .ok()
                .and_then(|v| v)
                .is_some()
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }

        let err =
            ServiceSupervisor::spawn(&sidecar, &dir, None, None).expect_err("second must fail");
        assert!(matches!(err, SuperviseError::AlreadyLocked { .. }));

        first.stop(Duration::from_secs(10)).expect("stop");
        let _ = std::fs::remove_dir_all(dir);
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
    }

    #[test]
    #[serial]
    fn spawn_writes_service_log_file() {
        let sidecar = sidecar_path();
        if !require_sidecar_or_skip(&sidecar) {
            return;
        }
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
        let dir = std::env::temp_dir().join(format!(
            "collector-supervise-logs-{}",
            std::process::id()
        ));
        let mut sup = ServiceSupervisor::spawn(&sidecar, &dir, None, None).expect("spawn");
        let log = service_log_path(&dir);
        let body = wait_for_ready_log(&log, Duration::from_secs(20));
        assert!(log.is_file(), "expected log at {}", log.display());
        assert!(
            body.contains("COLLECTOR_SERVICE_READY ") && body.contains("\"baseUrl\""),
            "log body: {body:?}"
        );
        assert_eq!(sup.log_path(), log);
        sup.stop(Duration::from_secs(10)).expect("stop");
        let _ = std::fs::remove_dir_all(dir);
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
    }

    #[test]
    #[serial]
    fn spawn_domain_host_answers_http_ping() {
        let sidecar = sidecar_path();
        if !require_sidecar_or_skip(&sidecar) {
            return;
        }
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
        let dir = std::env::temp_dir().join(format!(
            "collector-supervise-ping-{}",
            std::process::id()
        ));
        let mut sup = ServiceSupervisor::spawn(&sidecar, &dir, None, None).expect("spawn");
        let body = wait_for_ready_log(&sup.log_path(), Duration::from_secs(20));
        let base_url = parse_ready_base_url(&body).unwrap_or_else(|| {
            panic!("READY baseUrl missing in log: {body:?}")
        });
        let ping_url = format!("{base_url}/ping");
        let out = Command::new("curl")
            .args(["-fsS", "--max-time", "5", &ping_url])
            .output()
            .expect("curl");
        assert!(
            out.status.success(),
            "curl ping failed: status={} stderr={}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        );
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(
            text.contains("\"pong\":true") || text.contains("\"ok\":true"),
            "unexpected ping body: {text}"
        );
        assert!(
            dir.join("collector.db").is_file(),
            "expected index DB at {}",
            dir.join("collector.db").display()
        );
        sup.stop(Duration::from_secs(10)).expect("stop");
        let _ = std::fs::remove_dir_all(dir);
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
    }
}
