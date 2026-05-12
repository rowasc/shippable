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
// If the sidecar didn't spawn, get_sidecar_port returns null and we throw.
// ServerHealthGate catches the error at boot and shows "Server unreachable"
// — worktree ingest and the prompt library both need the sidecar, so the
// app refuses to load without it.

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

// Resolves once Rust has confirmed the sidecar's Node listener is bound (or
// reports failure). The previous boot path probed /api/health immediately and
// lost the race against sidecar startup — keychain lookup + Bun spawn +
// Express listen() take a few hundred ms, and the gate flashed "Server
// unreachable" until the user clicked Retry. Now Rust emits
// `shippable:sidecar-ready` from the sidecar's stdout handler when it sees
// the server's "listening" line, and the gate awaits that before probing.
//
// Non-Tauri (browser dev): no sidecar to wait for, returns ready immediately
// and the gate falls through to its existing fetch — which will surface
// "unreachable" the usual way if `npm run dev` isn't running.
export type SidecarReady =
  | { ok: true }
  | { ok: false; reason: string };

export async function waitForSidecarReady(
  timeoutMs = 10000,
): Promise<SidecarReady> {
  if (!isTauri()) return { ok: true };

  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);

  let settled = false;
  let resolveFn!: (r: SidecarReady) => void;
  const done = new Promise<SidecarReady>((res) => {
    resolveFn = res;
  });
  const finish = (r: SidecarReady) => {
    if (settled) return;
    settled = true;
    resolveFn(r);
  };

  const unlistenReady = await listen<number>(
    "shippable:sidecar-ready",
    () => finish({ ok: true }),
  );
  const unlistenFailed = await listen<string>(
    "shippable:sidecar-failed",
    (e) => finish({ ok: false, reason: e.payload }),
  );

  // Recheck after listeners are registered: if the event fired between
  // mount and subscribe we'd miss it, but the port will already be set.
  const port = await invoke<number | null>("get_sidecar_port");
  if (port != null) finish({ ok: true });

  const timer = setTimeout(
    () => finish({ ok: false, reason: "sidecar didn't report ready in time" }),
    timeoutMs,
  );

  try {
    return await done;
  } finally {
    clearTimeout(timer);
    unlistenReady();
    unlistenFailed();
  }
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
        throw new Error("Sidecar not available");
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
