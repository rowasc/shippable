// JS/TS execution for the CodeRunner prototype.
//
// Runs the composed program inside a sandboxed iframe (`sandbox="allow-scripts"`,
// no allow-same-origin → null origin, no DOM access to the host). Communicates
// over postMessage; times out at 2s. Strips a small subset of TS annotations
// so common params/vars with `: Type` don't throw in the browser.

import type { ParsedSelection } from "./parseInputs";

export interface RunResult {
  ok: boolean;
  logs: string[];
  result?: string;
  error?: string;
}

const TIMEOUT_MS = 2000;

export async function runJs(
  parsed: ParsedSelection,
  inputs: Record<string, string>,
): Promise<RunResult> {
  const program = buildProgram(parsed, inputs);
  return runInSandbox(program);
}

function buildProgram(parsed: ParsedSelection, inputs: Record<string, string>): string {
  const src =
    parsed.lang === "ts" ? stripTsAnnotations(parsed.source) : parsed.source;
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
      return `${decls}\n${src}`;
    }
  }
}

// Very small TS -> JS stripper. Only handles what shows up in common function
// signatures and variable declarations. Not a real compiler; fails loud if
// the user selects something exotic.
function stripTsAnnotations(src: string): string {
  return (
    src
      // `: Type` in param lists and var decls — stop at ,)={ or end-of-line
      .replace(/:\s*[A-Za-z_$][\w$<>[\],\s|&.?]*(?=[,)=\n{])/g, "")
      // Generic params after identifiers:  foo<T>(...)
      .replace(/([A-Za-z_$][\w$]*)<[^<>]*>/g, "$1")
      // `as Type` casts
      .replace(/\s+as\s+[A-Za-z_$][\w$<>[\],\s|&.?]*/g, "")
      // `!` non-null assertions
      .replace(/!(?=[.,)\s;])/g, "")
  );
}

function runInSandbox(program: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const token = Math.random().toString(36).slice(2);
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.style.display = "none";
    // Loaded from same-origin (so the page CSP allows it as a frame), then
    // sandboxed without allow-same-origin so it runs at a null origin with no
    // DOM access to the host page. The sandbox HTML's own inline <script> is
    // forbidden by the parent CSP, which is why this lives in a separate file.
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
      const data = ev.data as { __runner?: string; ok?: boolean; logs?: string[]; result?: string; error?: string };
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
