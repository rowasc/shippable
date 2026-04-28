// TS transpile worker. Runs esbuild-wasm in a dedicated module Worker so the
// transpiler doesn't share globals with the page. Same network lockdown as
// php-worker.ts: same-origin fetch only, everything else blocked. esbuild
// fetches its own .wasm same-origin during initialize, so that path is
// allowed; nothing else needs the network.

// Network lockdown — applied before any dynamic import, so it's in place
// when esbuild loads. See php-worker.ts for the rationale; same shape here.
{
  const SELF_ORIGIN = self.location.origin;
  function sameOrigin(input: unknown): boolean {
    let raw: string;
    if (typeof input === "string") raw = input;
    else if (input instanceof URL) raw = input.href;
    else if (input && typeof input === "object" && "url" in input) raw = String((input as { url: unknown }).url);
    else return false;
    try {
      return new URL(raw, SELF_ORIGIN).origin === SELF_ORIGIN;
    } catch {
      return false;
    }
  }

  const ORIG_FETCH = self.fetch.bind(self);
  self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!sameOrigin(input)) {
      return Promise.reject(new TypeError("TS worker: cross-origin fetch blocked"));
    }
    return ORIG_FETCH(input, init);
  }) as typeof fetch;

  const OrigXHR = self.XMLHttpRequest;
  class GuardedXHR extends OrigXHR {
    open(method: string, url: string | URL, ...rest: unknown[]) {
      if (!sameOrigin(url)) {
        throw new TypeError("TS worker: cross-origin XHR blocked");
      }
      return (super.open as (...a: unknown[]) => void)(method, url, ...rest);
    }
  }
  (self as unknown as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
    GuardedXHR as unknown as typeof XMLHttpRequest;

  const blockingCtor = (name: string) =>
    function () {
      throw new TypeError(`TS worker: ${name} blocked`);
    } as unknown;
  (self as unknown as { WebSocket: unknown }).WebSocket = blockingCtor("WebSocket");
  (self as unknown as { EventSource: unknown }).EventSource = blockingCtor("EventSource");
  (self as unknown as { Worker: unknown }).Worker = blockingCtor("Worker");
  for (const name of ["SharedWorker", "WebTransport", "WebSocketStream"]) {
    const g = self as unknown as Record<string, unknown>;
    if (typeof g[name] !== "undefined") g[name] = blockingCtor(name);
  }
}

// esbuild's wasm binary URL — Vite fingerprints + serves it.
import wasmUrl from "esbuild-wasm/esbuild.wasm?url";

interface TranspileResult {
  ok: boolean;
  js?: string;
  warnings?: string[];
  error?: string;
}

let initPromise: Promise<typeof import("esbuild-wasm")> | null = null;
function ensureEsbuild() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const esbuild = await import("esbuild-wasm");
    await esbuild.initialize({ wasmURL: wasmUrl, worker: false });
    return esbuild;
  })();
  return initPromise;
}

interface WorkerRequest { __id: number; code?: string; probe?: boolean }

self.addEventListener("message", async (ev: MessageEvent) => {
  const data = ev.data as WorkerRequest;
  if (!data || typeof data.__id !== "number") return;

  if (data.probe) {
    const probes = {
      fetch: await probeFetch(),
      xhr: probeXhr(),
      websocket: probeWebSocket(),
      eventsource: probeEventSource(),
      subworker: probeSubworker(),
    };
    (self as unknown as Worker).postMessage({ __id: data.__id, probes });
    return;
  }

  if (typeof data.code !== "string") return;
  try {
    const esbuild = await ensureEsbuild();
    const result = await esbuild.transform(data.code, {
      loader: "ts",
      // Don't minify — keep the output close to the input for runtime debugging.
    });
    const out: TranspileResult = {
      ok: true,
      js: result.code,
      warnings: result.warnings.map((w) => w.text),
    };
    (self as unknown as Worker).postMessage({ __id: data.__id, ...out });
  } catch (e) {
    const out: TranspileResult = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    (self as unknown as Worker).postMessage({ __id: data.__id, ...out });
  }
});

async function probeFetch(): Promise<"BLOCKED" | "NO_BLOCK"> {
  try { await fetch("https://example.com/?leak"); return "NO_BLOCK"; }
  catch { return "BLOCKED"; }
}
function probeXhr(): "BLOCKED" | "NO_BLOCK" {
  try { const x = new XMLHttpRequest(); x.open("GET", "https://example.com/?leak"); return "NO_BLOCK"; }
  catch { return "BLOCKED"; }
}
function probeWebSocket(): "BLOCKED" | "NO_BLOCK" {
  try { new WebSocket("wss://example.com"); return "NO_BLOCK"; }
  catch { return "BLOCKED"; }
}
function probeEventSource(): "BLOCKED" | "NO_BLOCK" {
  try { new EventSource("https://example.com"); return "NO_BLOCK"; }
  catch { return "BLOCKED"; }
}
function probeSubworker(): "BLOCKED" | "NO_BLOCK" {
  try {
    const blob = new Blob(["self.postMessage('hi')"], { type: "application/javascript" });
    new Worker(URL.createObjectURL(blob));
    return "NO_BLOCK";
  } catch {
    return "BLOCKED";
  }
}
