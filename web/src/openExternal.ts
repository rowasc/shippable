// Open a URL in the OS's default browser.
//
// In Wry/WKWebView (Tauri's webview) plain `<a target="_blank">` is dropped
// silently — see AGENTS.md. The shell plugin's `open()` hands the URL to the
// OS, which is the portable escape hatch.
//
// In the browser build we fall back to window.open. The dynamic import keeps
// the plugin out of the browser bundle.

import { isTauri } from "./keychain";

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  }
  window.open(url, "_blank", "noreferrer");
}
