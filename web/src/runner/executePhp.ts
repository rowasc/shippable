// PHP execution backed by @php-wasm/web (WordPress Playground).
//
// Lazy-loads a real PHP 8.3 runtime on the first call so the rest of the app
// stays light. Keeps a single cached `PHP` instance for subsequent calls —
// each `run()` resets PHP's request state, so it's safe to reuse.
//
// We compose a tiny PHP script that binds the user's inputs to top-level
// variables, then pastes the selected source. For function-shaped
// selections we also append a call expression and emit its return value.

import type { ParsedSelection, RunnerShape } from "./parseInputs";
import type { RunResult } from "./executeJs";

let phpPromise: Promise<{ run: (code: string) => Promise<{ stdout: string; stderr: string; exitCode: number }> }> | null = null;

function loadPhp() {
  if (phpPromise) return phpPromise;
  phpPromise = (async () => {
    // Import the version-specific package directly so Rolldown only bundles
    // PHP 8.3 (loadWebRuntime's switch over 8 versions would pull them all).
    const [webPkg, { loadPHPRuntime, PHP }] = await Promise.all([
      // The version-specific package doesn't ship types — its shape is
      // `{ getPHPLoaderModule(): Promise<PHPLoaderModule> }`.
      import("@php-wasm/web-8-3" as string) as Promise<{
        getPHPLoaderModule: () => Promise<unknown>;
      }>,
      import("@php-wasm/universal"),
    ]);
    if (!("setImmediate" in globalThis)) {
      // Emscripten relies on this; polyfill before loading the runtime.
      (globalThis as unknown as { setImmediate: typeof setTimeout }).setImmediate =
        ((cb: (...args: unknown[]) => void) => setTimeout(cb, 0)) as typeof setTimeout;
    }
    const loaderModule = await webPkg.getPHPLoaderModule();
    // The PHPLoaderModule type isn't exported as a value, so cast at the boundary.
    const runtimeId = await loadPHPRuntime(loaderModule as Parameters<typeof loadPHPRuntime>[0], {});
    const php = new PHP(runtimeId);
    const decoder = new TextDecoder();
    return {
      async run(code: string) {
        const response = await php.run({ code });
        return {
          stdout: decoder.decode(response.bytes),
          stderr: response.errors,
          exitCode: response.exitCode,
        };
      },
    };
  })();
  return phpPromise;
}

export async function runPhp(
  parsed: ParsedSelection,
  inputs: Record<string, string>,
): Promise<RunResult> {
  let php;
  try {
    php = await loadPhp();
  } catch (e) {
    return {
      ok: false,
      logs: [],
      error:
        "Couldn't load the PHP runtime: " +
        (e instanceof Error ? e.message : String(e)),
    };
  }

  const script = buildScript(parsed, inputs);

  try {
    const r = await php.run(script);
    const stdout = stripResultMarker(r.stdout);
    const logs = stdout.text ? ["out " + stdout.text] : [];
    return {
      ok: r.exitCode === 0 && !r.stderr,
      logs,
      result: stdout.result,
      error: r.stderr || (r.exitCode !== 0 ? `exit ${r.exitCode}` : undefined),
    };
  } catch (e) {
    return {
      ok: false,
      logs: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const RESULT_BEGIN = "\x1f__rs_result_begin__\x1f";
const RESULT_END = "\x1f__rs_result_end__\x1f";

function buildScript(parsed: ParsedSelection, inputs: Record<string, string>): string {
  const lines: string[] = ["<?php"];
  // Bind every input slot as a PHP variable. `phpLiteral` decides whether the
  // user's text is a number, boolean, quoted string, or array-like literal so
  // `2` stays an int and `"hi"` stays a string.
  const assigned = collectInputNames(parsed.shape);
  for (const name of assigned) {
    lines.push(`$${name} = ${phpLiteral(inputs[name])};`);
  }

  // Paste the selection. Strip a leading `<?php` if the user happened to
  // select one — we already opened a tag.
  const src = parsed.source.replace(/^\s*<\?php\s*/, "").replace(/\?>\s*$/, "");

  if (parsed.shape.kind === "anon-fn") {
    // Bind the closure to a variable so we can call it after.
    lines.push("$__rs_anon = " + src.replace(/;\s*$/, "") + ";");
  } else {
    lines.push(src);
  }

  // For function-shaped selections, append a call. A marker brackets the
  // return value so we can split it from the function's own stdout.
  if (parsed.shape.kind !== "free") {
    const callee =
      parsed.shape.kind === "named-fn" ? parsed.shape.name : "$__rs_anon";
    const argList = parsed.shape.params.map((p) => "$" + p).join(", ");
    lines.push(
      `$__rs_ret = is_callable(${callee}) ? ${callee}(${argList}) : null;`,
    );
    lines.push(
      `if ($__rs_ret !== null) { echo ${JSON.stringify(RESULT_BEGIN)}; var_export($__rs_ret); echo ${JSON.stringify(RESULT_END)}; }`,
    );
  }

  return lines.join("\n") + "\n";
}

function collectInputNames(shape: RunnerShape): string[] {
  return shape.kind === "free" ? shape.vars : shape.params;
}

function phpLiteral(raw: string | undefined): string {
  if (raw === undefined || raw === "") return "null";
  const t = raw.trim();
  if (/^-?\d+$/.test(t)) return t;
  if (/^-?\d*\.\d+$/.test(t)) return t;
  if (t === "true" || t === "false" || t === "null") return t;
  // Quoted strings — pass through.
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t;
  }
  // Bare PHP function calls or expressions (e.g. `[1,2,3]`, `array(1,2)`) —
  // pass through. Heuristic: if it contains characters PHP would parse, send
  // it raw; otherwise quote it as a string.
  if (/[[\](){},]/.test(t)) return t;
  return JSON.stringify(t);
}

function stripResultMarker(stdout: string): { text: string; result?: string } {
  const begin = stdout.indexOf(RESULT_BEGIN);
  if (begin === -1) return { text: stdout };
  const end = stdout.indexOf(RESULT_END, begin + RESULT_BEGIN.length);
  if (end === -1) return { text: stdout };
  const text = stdout.slice(0, begin) + stdout.slice(end + RESULT_END.length);
  const result = stdout.slice(begin + RESULT_BEGIN.length, end);
  return { text, result };
}
