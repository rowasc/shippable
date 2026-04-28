// PHP worker. Runs the @php-wasm runtime off the main thread so user PHP
// code can't reach the host page's DOM, cookies, or localStorage. This file
// is loaded as a module Worker; communication is plain postMessage.
//
// Network lockdown — applied at the very top, before any dynamic import, so
// it's in place by the time @php-wasm loads. Same-origin fetches are still
// allowed (php-wasm needs them to fetch its own WASM binary on first run);
// everything cross-origin is rejected. WebSocket / EventSource are blocked
// outright. Done at the JS layer rather than via a hosting CSP header so
// the guarantee travels with the code instead of being a deployment foot
// gun ("did you remember to set the right header?").
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
      return Promise.reject(
        new TypeError("PHP worker: cross-origin fetch blocked"),
      );
    }
    return ORIG_FETCH(input, init);
  }) as typeof fetch;

  const OrigXHR = self.XMLHttpRequest;
  class GuardedXHR extends OrigXHR {
    open(method: string, url: string | URL, ...rest: unknown[]) {
      if (!sameOrigin(url)) {
        throw new TypeError("PHP worker: cross-origin XHR blocked");
      }
      // The base `open` overload is variadic; pass through rest as-is.
      return (super.open as (...a: unknown[]) => void)(method, url, ...rest);
    }
  }
  (self as unknown as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
    GuardedXHR as unknown as typeof XMLHttpRequest;

  const blockingCtor = (name: string) =>
    function () {
      throw new TypeError(`PHP worker: ${name} blocked`);
    } as unknown;
  (self as unknown as { WebSocket: unknown }).WebSocket = blockingCtor("WebSocket");
  (self as unknown as { EventSource: unknown }).EventSource = blockingCtor("EventSource");
}

interface PhpRuntime {
  run(opts: { code: string }): Promise<{ bytes: Uint8Array; errors: string; exitCode: number }>;
}

let runtimePromise: Promise<PhpRuntime> | null = null;

function loadRuntime(): Promise<PhpRuntime> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    // Direct import of the version-specific package keeps Rolldown from
    // bundling every PHP version (loadWebRuntime's switch over 8 versions
    // would pull them all). The package doesn't ship types — its shape is
    // `{ getPHPLoaderModule(): Promise<PHPLoaderModule> }`.
    const [webPkg, { loadPHPRuntime, PHP }] = await Promise.all([
      import("@php-wasm/web-8-3" as string) as Promise<{
        getPHPLoaderModule: () => Promise<unknown>;
      }>,
      import("@php-wasm/universal"),
    ]);
    if (!("setImmediate" in globalThis)) {
      (globalThis as unknown as { setImmediate: typeof setTimeout }).setImmediate =
        ((cb: (...args: unknown[]) => void) => setTimeout(cb, 0)) as typeof setTimeout;
    }
    const loaderModule = await webPkg.getPHPLoaderModule();
    const runtimeId = await loadPHPRuntime(
      loaderModule as Parameters<typeof loadPHPRuntime>[0],
      {},
    );
    return new PHP(runtimeId) as unknown as PhpRuntime;
  })();
  return runtimePromise;
}

interface WorkerRequest { __id: number; code?: string; probe?: boolean }

self.addEventListener("message", async (ev: MessageEvent) => {
  const data = ev.data as WorkerRequest;
  if (!data || typeof data.__id !== "number") return;

  // Self-test: the smoke uses this to verify the network lockdown above is
  // actually in effect. Each probe attempts an exfiltration path and
  // reports whether it was blocked.
  if (data.probe) {
    const probes = {
      fetch: await probeFetch(),
      xhr: probeXhr(),
      websocket: probeWebSocket(),
      eventsource: probeEventSource(),
    };
    (self as unknown as Worker).postMessage({ __id: data.__id, probes });
    return;
  }

  if (typeof data.code !== "string") return;
  try {
    const php = await loadRuntime();
    const response = await php.run({ code: data.code });
    const decoder = new TextDecoder();
    (self as unknown as Worker).postMessage({
      __id: data.__id,
      ok: true,
      stdout: decoder.decode(response.bytes),
      stderr: response.errors,
      exitCode: response.exitCode,
    });
  } catch (e) {
    (self as unknown as Worker).postMessage({
      __id: data.__id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

async function probeFetch(): Promise<"BLOCKED" | "NO_BLOCK"> {
  try {
    await fetch("https://example.com/?leak");
    return "NO_BLOCK";
  } catch {
    return "BLOCKED";
  }
}
function probeXhr(): "BLOCKED" | "NO_BLOCK" {
  try {
    const x = new XMLHttpRequest();
    x.open("GET", "https://example.com/?leak");
    return "NO_BLOCK";
  } catch {
    return "BLOCKED";
  }
}
function probeWebSocket(): "BLOCKED" | "NO_BLOCK" {
  try {
    new WebSocket("wss://example.com");
    return "NO_BLOCK";
  } catch {
    return "BLOCKED";
  }
}
function probeEventSource(): "BLOCKED" | "NO_BLOCK" {
  try {
    new EventSource("https://example.com");
    return "NO_BLOCK";
  } catch {
    return "BLOCKED";
  }
}
