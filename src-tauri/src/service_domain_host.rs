//! Launch the real Node domain host under the Rust sidecar (#237 / epic #142).
//!
//! The packaged `collector-service` binary keeps the sole-writer lock and
//! supervises `node …/host/cli.js serve --data-dir …`. The Node child opens
//! SQLite and serves HTTP + local IPC. Default app path still does not spawn
//! this process until #170.

use std::env;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Arc;
use std::thread;

/// Override path to `packages/service/dist/host/cli.js` (or packaged copy).
pub const NODE_CLI_ENV: &str = "COLLECTOR_SERVICE_NODE_CLI";
/// Override Node executable (default: `node` on PATH).
pub const NODE_BIN_ENV: &str = "COLLECTOR_SERVICE_NODE";

static FORWARD_CHILD_PID: AtomicI32 = AtomicI32::new(0);

#[derive(Debug)]
pub enum DomainHostLaunchError {
    CliNotFound(String),
    Io(io::Error),
    ChildExitedEarly { status: Option<i32>, hint: String },
}

impl std::fmt::Display for DomainHostLaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CliNotFound(msg) => write!(f, "{msg}"),
            Self::Io(err) => write!(f, "{err}"),
            Self::ChildExitedEarly { status, hint } => {
                write!(
                    f,
                    "domain host exited before READY (status={status:?}): {hint}"
                )
            }
        }
    }
}

impl std::error::Error for DomainHostLaunchError {}

impl From<io::Error> for DomainHostLaunchError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

/// Resolve `host/cli.js` for the Node domain host.
pub fn resolve_host_cli() -> Result<PathBuf, DomainHostLaunchError> {
    if let Ok(raw) = env::var(NODE_CLI_ENV) {
        let path = PathBuf::from(&raw);
        if path.is_file() {
            return Ok(path);
        }
        return Err(DomainHostLaunchError::CliNotFound(format!(
            "{NODE_CLI_ENV}={raw} is not a file"
        )));
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("collector-service-host/cli.js"));
            candidates.push(dir.join("resources/collector-service-host/cli.js"));
        }
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
         (expected packages/service/dist/host/cli.js)"
    )))
}

pub fn resolve_node_bin() -> PathBuf {
    env::var_os(NODE_BIN_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"))
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
        signal(SIGTERM, forward as usize);
        signal(SIGINT, forward as usize);
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
pub fn run_domain_host_serve(data_dir: &Path) -> Result<i32, DomainHostLaunchError> {
    let cli = resolve_host_cli()?;
    let node = resolve_node_bin();

    let mut cmd = Command::new(&node);
    cmd.arg(&cli)
        .arg("serve")
        .arg("--data-dir")
        .arg(data_dir)
        .stdin(Stdio::null())
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
        DomainHostLaunchError::Io(io::Error::new(
            io::ErrorKind::Other,
            "missing domain host stdout",
        ))
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        DomainHostLaunchError::Io(io::Error::new(
            io::ErrorKind::Other,
            "missing domain host stderr",
        ))
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
