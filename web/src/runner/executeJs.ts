// JS/TS execution for the CodeRunner prototype.
//
// Runs the composed program inside a sandboxed iframe (`sandbox="allow-scripts"`,
// no allow-same-origin → null origin, no DOM access to the host). Communicates
// over postMessage; times out at 2s. TypeScript is transpiled to JS via
// esbuild-wasm running in a locked-down worker (ts-worker.ts) — see that file
// for the network lockdown details.

import TsWorker from "./ts-worker.ts?worker";
import type { ParsedSelection } from "./parseInputs";

export interface RunResult {
  ok: boolean;
  logs: string[];
  result?: string;
  error?: string;
  /** Final values of any bound input slots (free shape). */
  vars?: Record<string, string>;
}

const TIMEOUT_MS = 2000;

export async function runJs(
  parsed: ParsedSelection,
  inputs: Record<string, string>,
): Promise<RunResult> {
  let source = parsed.source;
  if (parsed.lang === "ts") {
    try {
      source = await transpileTs(source);
    } catch (e) {
      return {
        ok: false,
        logs: [],
        error: "TS transpile failed: " + (e instanceof Error ? e.message : String(e)),
      };
    }
  }
  const program = buildProgram({ ...parsed, source }, inputs);
  return runInSandbox(program);
}

interface TranspileResponse {
  __id: number;
  ok: boolean;
  js?: string;
  warnings?: string[];
  error?: string;
  probes?: Record<string, "BLOCKED" | "NO_BLOCK">;
}

let tsWorker: Worker | null = null;
let nextTsId = 1;
const tsPending = new Map<number, (resp: TranspileResponse) => void>();

function ensureTsWorker(): Worker {
  if (tsWorker) return tsWorker;
  tsWorker = new TsWorker();
  tsWorker.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data as TranspileResponse;
    if (!data || typeof data.__id !== "number") return;
    const cb = tsPending.get(data.__id);
    if (cb) {
      tsPending.delete(data.__id);
      cb(data);
    }
  });
  tsWorker.addEventListener("error", (ev) => {
    const err = (ev as ErrorEvent).message ?? "ts-worker error";
    for (const cb of tsPending.values()) {
      cb({ __id: -1, ok: false, error: err });
    }
    tsPending.clear();
    tsWorker?.terminate();
    tsWorker = null;
  });
  return tsWorker;
}

async function transpileTs(code: string): Promise<string> {
  const w = ensureTsWorker();
  const id = nextTsId++;
  const resp = await new Promise<TranspileResponse>((resolve) => {
    tsPending.set(id, resolve);
    w.postMessage({ __id: id, code });
  });
  if (!resp.ok) throw new Error(resp.error ?? "transpile failed");
  // esbuild appends `;\n` to expression statements. That breaks the
  // anon-fn wrap (`const __fn = ((a) => a*2;);` is a syntax error).
  // Trimming is safe for the other shapes too.
  return (resp.js ?? "").replace(/[\s;]+$/, "");
}

/**
 * Test-only: ask the TS worker to run its own network-lockdown self-test.
 * Mirrors `probeWorker()` in executePhp.ts.
 */
export function probeTsWorker(): Promise<Record<string, "BLOCKED" | "NO_BLOCK">> {
  const w = ensureTsWorker();
  const id = nextTsId++;
  return new Promise((resolve) => {
    tsPending.set(id, (resp) => {
      resolve(resp.probes ?? {});
    });
    w.postMessage({ __id: id, probe: true });
  });
}

function buildProgram(parsed: ParsedSelection, inputs: Record<string, string>): string {
  // By the time we get here, TS has already been transpiled to JS upstream
  // in runJs. buildProgram only sees plain JS source.
  const src = parsed.source;
  const shape = parsed.shape;

  switch (shape.kind) {
    case "anon-fn": {
      const args = shape.params.map((p) => inputs[p] ?? "undefined").join(", ");
      return `const __fn = (${src});\nconst __out = await __fn(${args});\nif (__out !== undefined) __result = __out;`;
    }
    case "named-fn": {
      const args = shape.params.map((p) => inputs[p] ?? "undefined").join(", ");
      return `${src}\nconst __out = await ${shape.name}(${args});\nif (__out !== undefined) __result = __out;`;
    }
    case "free": {
      const decls = shape.vars
        .map((v) => `let ${v} = ${inputs[v] ?? "undefined"};`)
        .join("\n");
      // Direct `eval` runs in our function's lexical scope, so it sees the
      // declarations above and its completion value (the value of the last
      // expression statement, e.g. `a * 2`) becomes the captured result.
      // After it runs we snapshot every bound input slot — users may have
      // mutated them.
      const slots = JSON.stringify(shape.vars);
      return [
        decls,
        `__result = eval(${JSON.stringify(src)});`,
        `__vars = {};`,
        `for (const __k of ${slots}) { try { __vars[__k] = eval(__k); } catch {} }`,
      ].join("\n");
    }
  }
}

function runInSandbox(program: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const token = Math.random().toString(36).slice(2);
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.style.display = "none";
    // Loaded from same-origin (so the page CSP allows it as a frame), then
    // sandboxed without allow-same-origin so it runs at a null origin with no
    // DOM access to the host page. The sandbox HTML carries its own CSP
    // (default-src 'none', no connect/img/etc.) to block exfiltration.
    iframe.src = "/runner-sandbox.html";

    let settled = false;
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      iframe.remove();
      resolve(r);
    };

    function onMessage(ev: MessageEvent) {
      // Reject messages that didn't come from our sandbox iframe — defense
      // in depth in case any other frame on the page guesses the token.
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data as {
        __runner?: string;
        ok?: boolean;
        logs?: string[];
        result?: string;
        error?: string;
        vars?: Record<string, string>;
      };
      if (!data || !data.__runner) return;
      if (data.__runner === "ready") {
        iframe.contentWindow?.postMessage({ __runner: token, code: program }, "*");
        return;
      }
      if (data.__runner !== token) return;
      finish({
        ok: !!data.ok,
        logs: data.logs ?? [],
        result: data.result,
        error: data.error,
        vars: data.vars,
      });
    }

    const timer = window.setTimeout(
      () => finish({ ok: false, logs: [], error: `Timed out after ${TIMEOUT_MS}ms` }),
      TIMEOUT_MS,
    );

    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
  });
}
