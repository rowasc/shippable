// PHP worker. Runs the @php-wasm runtime off the main thread so user PHP
// code can't reach the host page's DOM, cookies, or localStorage. This file
// is loaded as a module Worker; communication is plain postMessage.

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

interface WorkerRequest { __id: number; code: string }

self.addEventListener("message", async (ev: MessageEvent) => {
  const data = ev.data as WorkerRequest;
  if (!data || typeof data.__id !== "number" || typeof data.code !== "string") return;
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
