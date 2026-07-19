//! Unix-socket Service IPC client for Tauri ↔ Node host (#170 / epic #142).
//!
//! Wire format matches `packages/service` framing: 4-byte BE length + UTF-8 JSON.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const PROTOCOL_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Debug)]
pub enum ServiceIpcError {
    Io(std::io::Error),
    Framing(String),
    Protocol(String),
    Remote { layer: String, code: String, message: String },
    Timeout,
    NotConnected,
}

impl std::fmt::Display for ServiceIpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(err) => write!(f, "service IPC I/O: {err}"),
            Self::Framing(msg) => write!(f, "service IPC framing: {msg}"),
            Self::Protocol(msg) => write!(f, "service IPC protocol: {msg}"),
            Self::Remote { layer, code, message } => {
                write!(f, "service IPC {layer}/{code}: {message}")
            }
            Self::Timeout => write!(f, "service IPC request timed out"),
            Self::NotConnected => write!(f, "service IPC not connected"),
        }
    }
}

impl std::error::Error for ServiceIpcError {}

impl From<std::io::Error> for ServiceIpcError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
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

fn read_frame(stream: &mut UnixStream) -> Result<Value, ServiceIpcError> {
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
    data_dir.join("collector-service.sock")
}

/// Blocking request/response client (one connection; serialized).
pub struct ServiceIpcClient {
    stream: Mutex<UnixStream>,
    next_id: AtomicU64,
}

impl ServiceIpcClient {
    pub fn connect(path: &Path, timeout: Duration) -> Result<Self, ServiceIpcError> {
        let deadline = std::time::Instant::now() + timeout;
        let stream = loop {
            match UnixStream::connect(path) {
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
                .expect("object")
                .insert("params".into(), params);
        }
        let frame = encode_frame(&msg)?;
        let mut guard = self
            .stream
            .lock()
            .map_err(|_| ServiceIpcError::Protocol("ipc mutex poisoned".into()))?;
        guard.write_all(&frame)?;
        guard.flush()?;

        // Read until matching res/err; ignore evt frames for now (sync status via separate poll).
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
                let err = reply.get("error").cloned().unwrap_or(Value::Null);
                return Err(ServiceIpcError::Remote {
                    layer: err
                        .get("layer")
                        .and_then(|v| v.as_str())
                        .unwrap_or("domain")
                        .to_string(),
                    code: err
                        .get("code")
                        .and_then(|v| v.as_str())
                        .unwrap_or("error")
                        .to_string(),
                    message: err
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("service error")
                        .to_string(),
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
        let _ = guard.shutdown(Shutdown::Both);
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
        assert_eq!(
            default_ipc_path(Path::new("/data")),
            PathBuf::from("/data/collector-service.sock")
        );
    }
}
