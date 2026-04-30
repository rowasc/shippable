// Resolves an absolute URL for an `/api/*` endpoint served by the bundled
// server.
//
// In browser dev mode (vite dev server, no Tauri) the page origin is
// http://localhost:5173 and vite proxies /api/* to the standalone server on
// :3001 — relative paths Just Work, so we return the path unchanged.
//
// In the bundled Tauri app the page is served from tauri://localhost. Relative
// fetches against a custom scheme don't reach the sidecar (and WKWebView
// surfaces the failure as the cryptic "TypeError: The string did not match the
// expected pattern."), so we have to point fetch at the loopback port the
// sidecar bound. Rust picks a free port at startup and exposes it via the
// `get_sidecar_port` command; we resolve and cache it on first call.
//
// If the sidecar didn't spawn (e.g. no Anthropic key in Keychain),
// get_sidecar_port returns null and we throw — callers surface the error to
// the user.

let cachedBase: Promise<string> | null = null;

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__,
    )
  );
}

export async function apiUrl(path: string): Promise<string> {
  if (!path.startsWith("/")) {
    throw new Error(`apiUrl path must start with "/", got: ${path}`);
  }
  if (!isTauri()) return path;

  if (!cachedBase) {
    cachedBase = (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const port = await invoke<number | null>("get_sidecar_port");
      if (port == null) {
        throw new Error("Sidecar not available (no Anthropic key in Keychain)");
      }
      return `http://127.0.0.1:${port}`;
    })().catch((err) => {
      // Don't cache the failure — let the next caller retry (e.g. after the
      // user adds a key and restarts).
      cachedBase = null;
      throw err;
    });
  }
  const base = await cachedBase;
  return `${base}${path}`;
}
