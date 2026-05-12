use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Instant;

use tauri::{Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod keychain;
mod menu;

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
    inner: Mutex<SidecarRuntime>,
}

#[derive(Default)]
struct SidecarRuntime {
    port: Option<u16>,
    child: Option<CommandChild>,
}

#[tauri::command]
fn get_sidecar_port(state: State<SidecarState>) -> Option<u16> {
    state.inner.lock().unwrap().port
}

fn find_free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

fn start_sidecar(app: tauri::AppHandle) {
    let startup = Instant::now();

    let key = match keychain::get(ANTHROPIC_KEY_ACCOUNT) {
        Ok(Some(key)) => {
            log::info!(
                "keychain lookup completed in {}ms",
                startup.elapsed().as_millis()
            );
            Some(key)
        }
        Ok(None) => {
            log::warn!(
                "no key in Keychain after {}ms (service=shippable account={ANTHROPIC_KEY_ACCOUNT}); \
                 AI plan will be unavailable until one is added",
                startup.elapsed().as_millis()
            );
            None
        }
        Err(e) => {
            log::warn!(
                "Keychain lookup error after {}ms: {e}",
                startup.elapsed().as_millis()
            );
            None
        }
    };

    let port = match find_free_port() {
        Ok(port) => port,
        Err(e) => {
            log::warn!(
                "port allocation failed after {}ms: {e}",
                startup.elapsed().as_millis()
            );
            return;
        }
    };

    let sidecar = match app.shell().sidecar("shippable-server") {
        Ok(sidecar) => sidecar,
        Err(e) => {
            log::warn!(
                "sidecar lookup failed after {}ms: {e}",
                startup.elapsed().as_millis()
            );
            return;
        }
    }
    .env("PORT", port.to_string())
    .env("SHIPPABLE_ALLOWED_ORIGINS", SIDECAR_ALLOWED_ORIGINS)
    // Always set ANTHROPIC_API_KEY — empty when Keychain has none — so the
    // sidecar doesn't silently inherit one from the .app's launch
    // environment. Keychain is the single source of truth on desktop;
    // letting parent env leak through made the prompt unreachable when the
    // shell had the var set.
    .env("ANTHROPIC_API_KEY", key.unwrap_or_default());

    // The Bun-compiled sidecar binary can't resolve the `library/` dir
    // from `import.meta.url` the way `tsx` can, so we point it at one
    // explicitly. Dev: the source repo (edits hot-pick up without a
    // rebuild). Release: the library bundled into the .app's Resources
    // dir via `tauri.conf.json#bundle.resources`.
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
    #[cfg(not(debug_assertions))]
    let sidecar = match app
        .path()
        .resolve("library", tauri::path::BaseDirectory::Resource)
    {
        Ok(library_path) => sidecar.env(
            "SHIPPABLE_LIBRARY_PATH",
            library_path.to_string_lossy().to_string(),
        ),
        Err(e) => {
            log::warn!("bundled library resource not resolvable: {e}");
            sidecar
        }
    };

    match sidecar.spawn() {
        Ok((mut rx, child)) => {
            log::info!(
                "sidecar spawned (port={port}) in {}ms; awaiting listener",
                startup.elapsed().as_millis()
            );

            // Stash the child immediately for kill-on-exit, but leave `port`
            // unset — clients use port presence as the readiness signal, and
            // Node hasn't bound the listener yet at this point.
            {
                let state = app.state::<SidecarState>();
                state.inner.lock().unwrap().child = Some(child);
            }

            let app_for_task = app.clone();
            tauri::async_runtime::spawn(async move {
                let mut announced = false;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            let line = String::from_utf8_lossy(&bytes);
                            let trimmed = line.trim_end();
                            log::info!("[sidecar] {trimmed}");
                            // Server logs this once `listen()` callback fires
                            // (server/src/index.ts). That's the moment the
                            // loopback port is actually accepting connections,
                            // so it's the moment we can let the WebView probe.
                            if !announced && trimmed.contains("[server] listening") {
                                announced = true;
                                let state = app_for_task.state::<SidecarState>();
                                state.inner.lock().unwrap().port = Some(port);
                                log::info!(
                                    "sidecar listener ready on 127.0.0.1:{port} in {}ms",
                                    startup.elapsed().as_millis()
                                );
                                let _ = app_for_task.emit("shippable:sidecar-ready", port);
                            }
                        }
                        CommandEvent::Stderr(bytes) => {
                            log::warn!("[sidecar] {}", String::from_utf8_lossy(&bytes).trim_end());
                        }
                        CommandEvent::Terminated(payload) => {
                            log::warn!(
                                "[sidecar] terminated (code={:?}, signal={:?})",
                                payload.code,
                                payload.signal
                            );
                            if !announced {
                                let _ = app_for_task.emit(
                                    "shippable:sidecar-failed",
                                    format!(
                                        "sidecar exited before listening (code={:?}, signal={:?})",
                                        payload.code, payload.signal
                                    ),
                                );
                            }
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(e) => {
            log::warn!(
                "sidecar spawn failed after {}ms: {e}",
                startup.elapsed().as_millis()
            );
            let _ = app.emit("shippable:sidecar-failed", format!("spawn failed: {e}"));
        }
    }
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

            app.manage(SidecarState {
                inner: Mutex::new(SidecarRuntime::default()),
            });

            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if let Some(action) = menu::action_for(event.id()) {
                    let _ = app.emit("shippable:menu", action);
                }
            });

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || start_sidecar(app_handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                if let Some(child) = state.inner.lock().unwrap().child.take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
