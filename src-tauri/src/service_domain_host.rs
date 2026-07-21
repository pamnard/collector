//! Launch the real Node domain host under the Rust sidecar (#237 / epic #142).
//!
//! The packaged `collector-service` binary keeps the sole-writer lock and
//! supervises `node …/host/cli.js serve --data-dir …`. The Node child opens
//! SQLite and serves HTTP + local IPC.
//!
//! Packaged layout: Tauri injects `COLLECTOR_SERVICE_NODE_CLI` +
//! `COLLECTOR_SERVICE_NODE` pointing at `resources/collector-service-host/`.
//! When that marker tree is present (or env is set), monorepo / system Node
//! fallbacks are forbidden.

use std::env;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Arc;
use std::thread;

/// Override path to `packages/service/dist/host/cli.js` (or packaged copy).
pub const NODE_CLI_ENV: &str = "COLLECTOR_SERVICE_NODE_CLI";
/// Override Node executable (default: `node` on PATH for monorepo-only runs).
pub const NODE_BIN_ENV: &str = "COLLECTOR_SERVICE_NODE";

static FORWARD_CHILD_PID: AtomicI32 = AtomicI32::new(0);

#[derive(Debug, thiserror::Error)]
pub enum DomainHostLaunchError {
    #[error("{0}")]
    CliNotFound(String),
    #[error("{0}")]
    NodeNotFound(String),
    #[error("{0}")]
    Io(#[from] io::Error),
    #[error("domain host exited before READY (status={status:?}): {hint}")]
    ChildExitedEarly { status: Option<i32>, hint: String },
}

fn packaged_cli_candidates_near(dir: &Path) -> [PathBuf; 2] {
    [
        dir.join("collector-service-host/cli.js"),
        dir.join("resources/collector-service-host/cli.js"),
    ]
}

fn packaged_host_dir_near(dir: &Path) -> [PathBuf; 2] {
    [
        dir.join("collector-service-host"),
        dir.join("resources/collector-service-host"),
    ]
}

fn packaged_node_bin(host_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        host_dir.join("node.exe")
    }
    #[cfg(not(windows))]
    {
        host_dir.join("node")
    }
}

/// True when a packaged host *directory* exists next to `dir` (marker tree),
/// regardless of whether `cli.js` is present. Presence of the directory without
/// `cli.js` is a hard error — never fall back to monorepo paths.
fn packaged_host_dir_present_near(dir: &Path) -> Option<PathBuf> {
    packaged_host_dir_near(dir)
        .into_iter()
        .find(|host_dir| host_dir.is_dir())
}

/// Resolve `host/cli.js` for the Node domain host.
pub fn resolve_host_cli() -> Result<PathBuf, DomainHostLaunchError> {
    if let Ok(raw) = env::var(NODE_CLI_ENV) {
        let path = PathBuf::from(&raw);
        if path.is_file() {
            return Ok(path.canonicalize().unwrap_or(path));
        }
        return Err(DomainHostLaunchError::CliNotFound(format!(
            "{NODE_CLI_ENV}={raw} is not a file"
        )));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Packaged marker tree: only packaged paths (no monorepo fallback).
            if let Some(host_dir) = packaged_host_dir_present_near(dir) {
                let cli = host_dir.join("cli.js");
                if cli.is_file() {
                    return Ok(cli.canonicalize().unwrap_or(cli));
                }
                return Err(DomainHostLaunchError::CliNotFound(format!(
                    "packaged host dir present at {} but missing cli.js",
                    host_dir.display()
                )));
            }
            for path in packaged_cli_candidates_near(dir) {
                if path.is_file() {
                    return Ok(path.canonicalize().unwrap_or(path));
                }
            }
        }
    }

    // Monorepo / out-of-band smokes only (no packaged marker).
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = env::current_exe() {
        for ancestor in exe.ancestors() {
            candidates.push(ancestor.join("packages/service/dist/host/cli.js"));
        }
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("../packages/service/dist/host/cli.js"));
    for ancestor in manifest.ancestors() {
        candidates.push(ancestor.join("packages/service/dist/host/cli.js"));
    }

    for path in &candidates {
        if path.is_file() {
            return Ok(path.canonicalize().unwrap_or_else(|_| path.clone()));
        }
    }

    Err(DomainHostLaunchError::CliNotFound(format!(
        "domain host CLI not found; set {NODE_CLI_ENV} or build @collector/service \
         (expected packages/service/dist/host/cli.js or packaged collector-service-host/cli.js)"
    )))
}

/// Resolve the Node binary. Packaged / env paths hard-fail; monorepo uses `node` on PATH.
pub fn resolve_node_bin() -> Result<PathBuf, DomainHostLaunchError> {
    if let Ok(raw) = env::var(NODE_BIN_ENV) {
        let path = PathBuf::from(&raw);
        if path.is_file() {
            return Ok(path.canonicalize().unwrap_or(path));
        }
        return Err(DomainHostLaunchError::NodeNotFound(format!(
            "{NODE_BIN_ENV}={raw} is not a file"
        )));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Some(host_dir) = packaged_host_dir_present_near(dir) {
                let node = packaged_node_bin(&host_dir);
                if node.is_file() {
                    return Ok(node.canonicalize().unwrap_or(node));
                }
                return Err(DomainHostLaunchError::NodeNotFound(format!(
                    "packaged host dir present at {} but missing bundled node binary",
                    host_dir.display()
                )));
            }
        }
    }

    Ok(PathBuf::from("node"))
}

#[cfg(unix)]
fn install_signal_forwarding() {
    extern "C" {
        fn signal(sig: i32, handler: usize) -> usize;
        fn kill(pid: i32, sig: i32) -> i32;
        fn _exit(status: i32) -> !;
    }
    const SIGTERM: i32 = 15;
    const SIGINT: i32 = 2;

    extern "C" fn forward(sig: i32) {
        let pid = FORWARD_CHILD_PID.load(Ordering::SeqCst);
        if pid > 0 {
            // SAFETY: forward SIGTERM/SIGINT to our Node domain-host child only.
            unsafe {
                let _ = kill(pid, sig);
            }
        }
        // Exit the sidecar; do not return into interrupted Rust code.
        unsafe {
            _exit(128 + sig);
        }
    }

    // SAFETY: replace default SIGTERM/SIGINT with forward-to-child handlers.
    unsafe {
        signal(SIGTERM, forward as *const () as usize);
        signal(SIGINT, forward as *const () as usize);
    }
}

#[cfg(not(unix))]
fn install_signal_forwarding() {}

fn spawn_stderr_forward(stderr: impl io::Read + Send + 'static) {
    thread::spawn(move || {
        let mut lines = BufReader::new(stderr).lines();
        while let Some(Ok(line)) = lines.next() {
            let _ = writeln!(io::stderr(), "{line}");
            let _ = io::stderr().flush();
        }
    });
}

/// Run Node `serve --data-dir …`, forward READY/stdio, wait until exit.
pub fn run_domain_host_serve(
    data_dir: &Path,
    config_dir: Option<&Path>,
) -> Result<i32, DomainHostLaunchError> {
    let cli = resolve_host_cli()?;
    let node = resolve_node_bin()?;

    let mut cmd = Command::new(&node);
    cmd.arg(&cli)
        .arg("serve")
        .arg("--data-dir")
        .arg(data_dir);
    if let Some(config_dir) = config_dir {
        cmd.arg("--config-dir").arg(config_dir);
    }
    // Ensure ESM/CJS resolution finds packaged better-sqlite3 next to cli.js.
    if let Some(cli_dir) = cli.parent() {
        cmd.current_dir(cli_dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child: Child = cmd.spawn().map_err(|err| {
        DomainHostLaunchError::Io(io::Error::new(
            err.kind(),
            format!(
                "failed to spawn domain host ({} {}): {err}",
                node.display(),
                cli.display()
            ),
        ))
    })?;

    FORWARD_CHILD_PID.store(child.id() as i32, Ordering::SeqCst);
    install_signal_forwarding();

    let stdout = child.stdout.take().ok_or_else(|| {
        DomainHostLaunchError::Io(io::Error::other("missing domain host stdout"))
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        DomainHostLaunchError::Io(io::Error::other("missing domain host stderr"))
    })?;

    let ready_seen = Arc::new(AtomicBool::new(false));
    let ready_flag = Arc::clone(&ready_seen);
    thread::spawn(move || {
        let mut lines = BufReader::new(stdout).lines();
        while let Some(Ok(line)) = lines.next() {
            if line.starts_with("COLLECTOR_SERVICE_READY ") {
                ready_flag.store(true, Ordering::SeqCst);
            }
            let _ = writeln!(io::stdout(), "{line}");
            let _ = io::stdout().flush();
        }
    });
    spawn_stderr_forward(stderr);

    let status = child.wait()?;
    FORWARD_CHILD_PID.store(0, Ordering::SeqCst);

    let code = status.code().unwrap_or(1);
    if !ready_seen.load(Ordering::SeqCst) && code != 0 {
        return Err(DomainHostLaunchError::ChildExitedEarly {
            status: status.code(),
            hint: format!("node={} cli={}", node.display(), cli.display()),
        });
    }
    Ok(code)
}
