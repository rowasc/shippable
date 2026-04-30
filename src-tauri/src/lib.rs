use std::net::TcpListener;
use std::sync::Mutex;

use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod keychain;

const ANTHROPIC_KEY_ACCOUNT: &str = "ANTHROPIC_API_KEY";

// Origins the bundled sidecar should accept. Covers the WebView origin Tauri
// uses on macOS/Linux (`tauri://localhost`) and the equivalent Windows form
// (`http://tauri.localhost`). In debug builds (`cargo tauri dev`) the page is
// served by Vite, so we also allow the dev origins — without this the
// preflight from the dev webview gets rejected with 403.
#[cfg(debug_assertions)]
const SIDECAR_ALLOWED_ORIGINS: &str =
    "tauri://localhost,http://tauri.localhost,http://localhost:5173,http://127.0.0.1:5173";
#[cfg(not(debug_assertions))]
const SIDECAR_ALLOWED_ORIGINS: &str = "tauri://localhost,http://tauri.localhost";

struct SidecarState {
    port: Option<u16>,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn get_sidecar_port(state: State<SidecarState>) -> Option<u16> {
    state.port
}

fn find_free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_sidecar_port,
            keychain::keychain_get,
            keychain::keychain_set,
            keychain::keychain_remove,
        ])
        .setup(|app| {
            // Logger runs in both debug and release. The .app bundle has no
            // attached terminal once launched from Finder, but `log!` calls
            // still surface in Console.app and are captured when the binary
            // is launched directly from a shell.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            let mut state = SidecarState {
                port: None,
                child: Mutex::new(None),
            };

            match keychain::get(ANTHROPIC_KEY_ACCOUNT) {
                Ok(Some(key)) => {
                    let port = find_free_port()
                        .map_err(|e| format!("port allocation failed: {e}"))?;
                    let sidecar = app
                        .shell()
                        .sidecar("shippable-server")
                        .map_err(|e| format!("sidecar lookup failed: {e}"))?
                        .env("ANTHROPIC_API_KEY", key)
                        .env("PORT", port.to_string())
                        .env("SHIPPABLE_ALLOWED_ORIGINS", SIDECAR_ALLOWED_ORIGINS);

                    // The Bun-compiled sidecar binary can't resolve the
                    // `library/` dir from `import.meta.url` the way `tsx` can,
                    // so point it at the source repo in dev. Production builds
                    // need the library bundled as a resource — not wired yet.
                    #[cfg(debug_assertions)]
                    let sidecar = {
                        let library_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                            .parent()
                            .unwrap()
                            .join("library");
                        sidecar.env(
                            "SHIPPABLE_LIBRARY_PATH",
                            library_path.to_string_lossy().to_string(),
                        )
                    };
                    match sidecar.spawn() {
                        Ok((mut rx, child)) => {
                            log::info!("sidecar started on 127.0.0.1:{port}");
                            // Pump sidecar stdout/stderr into the host log so
                            // [server] lines surface alongside Rust logs when
                            // the binary is launched from a terminal.
                            tauri::async_runtime::spawn(async move {
                                while let Some(event) = rx.recv().await {
                                    match event {
                                        CommandEvent::Stdout(bytes) => {
                                            log::info!(
                                                "[sidecar] {}",
                                                String::from_utf8_lossy(&bytes).trim_end()
                                            );
                                        }
                                        CommandEvent::Stderr(bytes) => {
                                            log::warn!(
                                                "[sidecar] {}",
                                                String::from_utf8_lossy(&bytes).trim_end()
                                            );
                                        }
                                        CommandEvent::Terminated(payload) => {
                                            log::warn!(
                                                "[sidecar] terminated (code={:?}, signal={:?})",
                                                payload.code,
                                                payload.signal
                                            );
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                            });
                            state.port = Some(port);
                            *state.child.lock().unwrap() = Some(child);
                        }
                        Err(e) => {
                            log::warn!("sidecar spawn failed: {e}");
                        }
                    }
                }
                Ok(None) => {
                    log::warn!(
                        "no key in Keychain (service=shippable account={ANTHROPIC_KEY_ACCOUNT}); \
                         AI plan will fall back to rule-based. Add via Settings (later) or run: \
                         security add-generic-password -s shippable -a {ANTHROPIC_KEY_ACCOUNT} -w"
                    );
                }
                Err(e) => {
                    log::warn!("Keychain lookup error: {e}");
                }
            }

            app.manage(state);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                if let Some(child) = state.child.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
