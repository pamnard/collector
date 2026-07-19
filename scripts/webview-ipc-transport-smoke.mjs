/**
 * Local smoke for #239 (documented here; primary automated check is
 * `cargo test --lib service_ipc::` → connect_ping_and_domain_rpc_against_live_host).
 *
 * Manual Tauri harness (dev):
 * 1. Start host: `npm run serve --workspace @collector/service -- --data-dir /tmp/collector-webview-ipc`
 * 2. Read READY ipcPath from stdout
 * 3. In Tauri WebView console (after app load): 
 *    const { tauriServiceIpcConnect, tauriServiceIpcPing, tauriServiceIpcRequest, tauriServiceIpcDisconnect } =
 *      await import('/src/services/tauri-service-ipc-transport.ts')
 *    await tauriServiceIpcConnect('<ipcPath>')
 *    await tauriServiceIpcPing()
 *    await tauriServiceIpcRequest('getDataDirectory')
 *    await tauriServiceIpcDisconnect()
 *
 * Default UI path stays LocalAdapter until #170.
 */
console.log("See file header for #239 WebView IPC transport smoke steps.");
