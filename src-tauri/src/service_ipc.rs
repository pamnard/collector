//! Local Service IPC proxy for WebView → host (#239 / epic #142).
//!
//! Unix domain socket on Unix; Windows named pipe (`\\.\pipe\…`) matching
//! `@collector/service` `defaultServiceIpcPath`.
//!
//! Wire format: 4-byte BE length + UTF-8 JSON.
//!
//! # Platform notes
//!
//! On Unix, connect sets read/write socket timeouts. On Windows named pipes
//! (`std::fs::File`), those timeouts are **not** enforced — overlapped I/O is
//! out of scope for this crate.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

const PROTOCOL_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ServiceIpcError {
    #[error("service IPC I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("service IPC framing: {0}")]
    Framing(String),
    #[error("service IPC protocol: {0}")]
    Protocol(String),
    #[error("service IPC {layer}/{code}: {message}")]
    Remote {
        layer: String,
        code: String,
        message: String,
    },
    #[error("service IPC request timed out")]
    Timeout,
    #[error("service IPC not connected")]
    NotConnected,
}

struct IpcStream {
    #[cfg(unix)]
    inner: std::os::unix::net::UnixStream,
    #[cfg(windows)]
    inner: std::fs::File,
}

impl Read for IpcStream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(buf)
    }
}

impl Write for IpcStream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.inner.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

impl IpcStream {
    fn connect(path: &Path) -> std::io::Result<Self> {
        #[cfg(unix)]
        {
            let inner = std::os::unix::net::UnixStream::connect(path)?;
            Ok(Self { inner })
        }
        #[cfg(windows)]
        {
            use std::fs::OpenOptions;
            use std::os::windows::fs::OpenOptionsExt;
            let inner = OpenOptions::new()
                .read(true)
                .write(true)
                .share_mode(0)
                .open(path)?;
            Ok(Self { inner })
        }
    }

    /// Set read timeout. **Unix only** — on Windows this is a no-op (see module docs).
    fn set_read_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            self.inner.set_read_timeout(timeout)
        }
        #[cfg(windows)]
        {
            // Named-pipe File has no std timeout API; do not pretend it works.
            let _ = timeout;
            Ok(())
        }
    }

    /// Set write timeout. **Unix only** — on Windows this is a no-op (see module docs).
    fn set_write_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            self.inner.set_write_timeout(timeout)
        }
        #[cfg(windows)]
        {
            let _ = timeout;
            Ok(())
        }
    }

    fn shutdown_both(&self) {
        #[cfg(unix)]
        {
            let _ = self.inner.shutdown(std::net::Shutdown::Both);
        }
        #[cfg(windows)]
        {}
    }
}

fn encode_frame(message: &Value) -> Result<Vec<u8>, ServiceIpcError> {
    let body = serde_json::to_vec(message)
        .map_err(|e| ServiceIpcError::Framing(e.to_string()))?;
    if body.len() > MAX_FRAME_BYTES {
        return Err(ServiceIpcError::Framing(format!(
            "frame body too large: {}",
            body.len()
        )));
    }
    let mut out = Vec::with_capacity(4 + body.len());
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend_from_slice(&body);
    Ok(out)
}

fn read_frame(stream: &mut IpcStream) -> Result<Value, ServiceIpcError> {
    let mut header = [0u8; 4];
    stream.read_exact(&mut header)?;
    let len = u32::from_be_bytes(header) as usize;
    if len > MAX_FRAME_BYTES {
        return Err(ServiceIpcError::Framing(format!(
            "frame length {len} exceeds max {MAX_FRAME_BYTES}"
        )));
    }
    let mut body = vec![0u8; len];
    stream.read_exact(&mut body)?;
    serde_json::from_slice(&body).map_err(|e| ServiceIpcError::Framing(e.to_string()))
}

pub fn default_ipc_path(data_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(data_dir.to_string_lossy().as_bytes());
        let digest = hasher.finalize();
        let id: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
        PathBuf::from(format!(r"\\.\pipe\collector-service-{id}"))
    }
    #[cfg(not(windows))]
    {
        data_dir.join("collector-service.sock")
    }
}

/// Blocking request/response client (one connection; serialized).
pub struct ServiceIpcClient {
    stream: Mutex<IpcStream>,
    next_id: AtomicU64,
}

impl ServiceIpcClient {
    pub fn connect(path: &Path, timeout: Duration) -> Result<Self, ServiceIpcError> {
        let deadline = std::time::Instant::now() + timeout;
        let stream = loop {
            match IpcStream::connect(path) {
                Ok(s) => break s,
                Err(err) => {
                    if std::time::Instant::now() >= deadline {
                        return Err(ServiceIpcError::Io(err));
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        };
        stream.set_read_timeout(Some(Duration::from_secs(30)))?;
        stream.set_write_timeout(Some(Duration::from_secs(30)))?;
        Ok(Self {
            stream: Mutex::new(stream),
            next_id: AtomicU64::new(1),
        })
    }

    pub fn request(&self, method: &str, params: Option<Value>) -> Result<Value, ServiceIpcError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let mut msg = json!({
            "v": PROTOCOL_VERSION,
            "id": id,
            "type": "req",
            "method": method,
        });
        if let Some(params) = params {
            msg.as_object_mut()
                .ok_or_else(|| {
                    ServiceIpcError::Protocol("request JSON must be an object".into())
                })?
                .insert("params".into(), params);
        }
        let frame = encode_frame(&msg)?;
        let mut guard = self
            .stream
            .lock()
            .map_err(|_| ServiceIpcError::Protocol("ipc mutex poisoned".into()))?;
        guard.write_all(&frame)?;
        guard.flush()?;

        loop {
            let reply = read_frame(&mut guard)?;
            let typ = reply
                .get("type")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ServiceIpcError::Framing("missing type".into()))?;
            if typ == "evt" {
                continue;
            }
            let reply_id = reply
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ServiceIpcError::Framing("missing id".into()))?;
            if reply_id != id {
                continue;
            }
            if typ == "res" {
                return Ok(reply.get("result").cloned().unwrap_or(Value::Null));
            }
            if typ == "err" {
                let err = reply
                    .get("error")
                    .ok_or_else(|| ServiceIpcError::Framing("missing error object".into()))?;
                let layer = err
                    .get("layer")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ServiceIpcError::Framing("missing error.layer".into()))?
                    .to_string();
                let code = err
                    .get("code")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ServiceIpcError::Framing("missing error.code".into()))?
                    .to_string();
                let message = err
                    .get("message")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ServiceIpcError::Framing("missing error.message".into()))?
                    .to_string();
                return Err(ServiceIpcError::Remote {
                    layer,
                    code,
                    message,
                });
            }
            return Err(ServiceIpcError::Framing(format!("unexpected type {typ}")));
        }
    }

    pub fn close(&self) -> Result<(), ServiceIpcError> {
        let guard = self
            .stream
            .lock()
            .map_err(|_| ServiceIpcError::Protocol("ipc mutex poisoned".into()))?;
        guard.shutdown_both();
        Ok(())
    }
}

/// Shared handle for Tauri state.
pub struct ServiceIpcState {
    pub client: Mutex<Option<Arc<ServiceIpcClient>>>,
    pub ipc_path: Mutex<Option<PathBuf>>,
}

impl ServiceIpcState {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
            ipc_path: Mutex::new(None),
        }
    }
}

impl Default for ServiceIpcState {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse `COLLECTOR_SERVICE_READY {...}` stdout line → ipcPath.
pub fn parse_ready_ipc_path(line: &str) -> Option<PathBuf> {
    const PREFIX: &str = "COLLECTOR_SERVICE_READY ";
    let json_str = line.trim().strip_prefix(PREFIX)?;
    let value: Value = serde_json::from_str(json_str).ok()?;
    value
        .get("ipcPath")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ready_line() {
        let line = r#"COLLECTOR_SERVICE_READY {"host":"127.0.0.1","port":1,"baseUrl":"http://127.0.0.1:1","ipcPath":"/tmp/x.sock"}"#;
        assert_eq!(
            parse_ready_ipc_path(line).as_deref(),
            Some(Path::new("/tmp/x.sock"))
        );
    }

    #[test]
    fn default_sock_under_data_dir() {
        #[cfg(windows)]
        {
            let p = default_ipc_path(Path::new(r"C:\data"));
            let s = p.to_string_lossy();
            assert!(s.starts_with(r"\\.\pipe\collector-service-"), "{s}");
            assert_eq!(s.len(), r"\\.\pipe\collector-service-".len() + 16);
        }
        #[cfg(not(windows))]
        {
            assert_eq!(
                default_ipc_path(Path::new("/data")),
                PathBuf::from("/data/collector-service.sock")
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn connect_ping_and_domain_rpc_against_live_host() {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};
        use std::sync::mpsc;
        use std::thread;
        use std::time::{Duration, Instant};

        let cli = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../packages/service/dist/host/cli.js");
        if !cli.is_file() {
            if std::env::var_os("CI").is_some() {
                panic!(
                    "missing {} (build @collector/service; required under CI)",
                    cli.display()
                );
            }
            eprintln!("skip: missing {} (build @collector/service)", cli.display());
            return;
        }
        let data_dir = std::env::temp_dir().join(format!(
            "collector-webview-ipc-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&data_dir);
        std::fs::create_dir_all(&data_dir).expect("mkdir");

        let mut child = Command::new("node")
            .arg(&cli)
            .arg("serve")
            .arg("--data-dir")
            .arg(&data_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn host");

        let stdout = child.stdout.take().expect("stdout");
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });

        let deadline = Instant::now() + Duration::from_secs(20);
        let mut ipc_path = None;
        while Instant::now() < deadline {
            if let Ok(line) = rx.recv_timeout(Duration::from_millis(50)) {
                if let Some(p) = parse_ready_ipc_path(&line) {
                    ipc_path = Some(p);
                    break;
                }
            }
            if let Ok(Some(status)) = child.try_wait() {
                panic!("host exited early: {status:?}");
            }
        }
        let ipc_path = ipc_path.expect("READY ipcPath");

        let client = ServiceIpcClient::connect(&ipc_path, Duration::from_secs(5)).expect("connect");
        let ping = client.request("ping", None).expect("ping");
        assert_eq!(ping.get("ok"), Some(&serde_json::json!(true)));
        assert_eq!(ping.get("pong"), Some(&serde_json::json!(true)));
        let health = client.request("health", None).expect("health");
        assert_eq!(health.get("ok"), Some(&serde_json::json!(true)));
        let data_dir_rpc = client
            .request("getDataDirectory", None)
            .expect("getDataDirectory");
        assert_eq!(
            data_dir_rpc.as_str().map(str::to_string),
            Some(data_dir.to_string_lossy().into_owned())
        );
        let _ = client.close();
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(&data_dir);
    }
}
