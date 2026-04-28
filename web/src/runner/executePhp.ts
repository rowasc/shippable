// PHP execution backed by @php-wasm/web (WordPress Playground).
//
// The runtime + WASM live in a Web Worker (php-worker.ts) so user PHP code
// can't reach the host page's DOM, cookies, or localStorage. The first run
// pays the cold-start cost (load worker → fetch ~21MB WASM → instantiate);
// subsequent runs reuse the same worker instance.
//
// We compose a tiny PHP script that binds the user's inputs to top-level
// variables, then pastes the selected source. For function-shaped
// selections we also append a call expression and emit its return value.

import PhpWorker from "./php-worker.ts?worker";
import type { ParsedSelection, RunnerShape } from "./parseInputs";
import type { RunResult } from "./executeJs";

interface PhpResponse {
  __id: number;
  ok: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (resp: PhpResponse) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new PhpWorker();
  worker.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data as PhpResponse;
    if (!data || typeof data.__id !== "number") return;
    const cb = pending.get(data.__id);
    if (cb) {
      pending.delete(data.__id);
      cb(data);
    }
  });
  worker.addEventListener("error", (ev) => {
    // If the worker dies, fail every pending call and reset so the next
    // run gets a fresh worker.
    const err = (ev as ErrorEvent).message ?? "worker error";
    for (const cb of pending.values()) {
      cb({ __id: -1, ok: false, error: err });
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

function runInWorker(code: string): Promise<PhpResponse> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ __id: id, code });
  });
}

export async function runPhp(
  parsed: ParsedSelection,
  inputs: Record<string, string>,
): Promise<RunResult> {
  const script = buildScript(parsed, inputs);

  try {
    const r = await runInWorker(script);
    if (!r.ok) {
      return {
        ok: false,
        logs: [],
        error: "Couldn't load the PHP runtime: " + (r.error ?? "unknown error"),
      };
    }
    const out = parseStdout(r.stdout ?? "");
    const logs = out.text ? ["out " + out.text] : [];
    return {
      ok: (r.exitCode ?? 0) === 0 && !r.stderr,
      logs,
      result: out.result,
      vars: out.vars,
      error:
        r.stderr ||
        ((r.exitCode ?? 0) !== 0 ? `exit ${r.exitCode}` : undefined),
    };
  } catch (e) {
    return {
      ok: false,
      logs: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ASCII-only sentinels: PHP double-quoted strings don't interpret JSON's
// `` escape, so any control-char marker we emit via JSON.stringify
// would arrive as literal text and break detection.
const RESULT_BEGIN = "~~RS:RESULT:BEGIN~~";
const RESULT_END = "~~RS:RESULT:END~~";
const VARS_BEGIN = "~~RS:VARS:BEGIN~~";
const VARS_END = "~~RS:VARS:END~~";

function buildScript(parsed: ParsedSelection, inputs: Record<string, string>): string {
  const lines: string[] = ["<?php"];
  // Bind every input slot as a PHP variable. `phpLiteral` decides whether the
  // user's text is a number, boolean, quoted string, or array-like literal so
  // `2` stays an int and `"hi"` stays a string.
  const assigned = collectInputNames(parsed.shape);
  for (const name of assigned) {
    lines.push(`$${name} = ${phpLiteral(inputs[name])};`);
  }

  // Strip a leading `<?php` if the user happened to select one — we already
  // opened a tag — and a trailing `?>`.
  const src = parsed.source.replace(/^\s*<\?php\s*/, "").replace(/\?>\s*$/, "");

  if (parsed.shape.kind === "anon-fn") {
    // Bind the closure to a variable so we can call it after.
    lines.push("$__rs_anon = " + src.replace(/;\s*$/, "") + ";");
  } else if (parsed.shape.kind === "free" && looksLikeExpression(src)) {
    // Single-expression selection — wrap so its value is captured. PHP has
    // no completion-value semantics so we have to opt in syntactically.
    const expr = src.trim().replace(/;\s*$/, "");
    lines.push(`$__rs_ret = (${expr});`);
    lines.push(emitResultMarker("$__rs_ret"));
  } else {
    // Multi-statement / non-expression source. PHP requires terminators —
    // append `;` if missing so a selection like `echo $a` parses.
    let stmt = src.trim();
    if (stmt && !/[;}]\s*$/.test(stmt)) stmt += ";";
    lines.push(stmt);
  }

  // For function-shaped selections, append a call. A marker brackets the
  // return value so we can split it from the function's own stdout.
  if (parsed.shape.kind !== "free") {
    const argList = parsed.shape.params.map((p) => "$" + p).join(", ");
    if (parsed.shape.kind === "named-fn") {
      // The function name is a bareword in PHP — needs quoting for the
      // is_callable check, otherwise PHP reads it as an undefined constant.
      const quoted = `'${parsed.shape.name.replace(/'/g, "\\'")}'`;
      lines.push(
        `$__rs_ret = function_exists(${quoted}) ? ${parsed.shape.name}(${argList}) : null;`,
      );
    } else {
      lines.push(
        `$__rs_ret = is_callable($__rs_anon) ? $__rs_anon(${argList}) : null;`,
      );
    }
    lines.push(emitResultMarker("$__rs_ret"));
  }

  // Snapshot the bound input slots (free shape only — for function shapes
  // these are arguments, not visible at top level after the call). Users may
  // have mutated them, so this is the best lightweight observability we get
  // without parsing the user's source.
  if (parsed.shape.kind === "free" && assigned.length > 0) {
    const list = assigned.map((n) => `'${n}'`).join(",");
    lines.push(`$__rs_vars_snap = compact(${list});`);
    // json_encode (vs var_export) gives us something the parent can parse
    // directly — JSON_INVALID_UTF8_SUBSTITUTE keeps non-UTF8 bytes from
    // breaking the round-trip.
    lines.push(
      `echo ${JSON.stringify(VARS_BEGIN)}; echo json_encode($__rs_vars_snap, JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR); echo ${JSON.stringify(VARS_END)};`,
    );
  }

  return lines.join("\n") + "\n";
}

function emitResultMarker(varExpr: string): string {
  return `if (${varExpr} !== null) { echo ${JSON.stringify(RESULT_BEGIN)}; var_export(${varExpr}); echo ${JSON.stringify(RESULT_END)}; }`;
}

// Heuristic: a "single expression" is one without intermediate `;` and
// without statement-introducing keywords. Good enough for things like
// `$a + $b`, `$a * 2`, `strlen($name)`. False negatives fall through to the
// multi-statement path which still runs verbatim.
function looksLikeExpression(src: string): boolean {
  const trimmed = src.trim().replace(/;$/, "").trim();
  if (!trimmed) return false;
  if (/;/.test(trimmed)) return false;
  if (
    /\b(echo|print|function|if|else|for|foreach|while|switch|class|return|namespace|use|require|include|try|throw)\b/.test(
      trimmed,
    )
  ) {
    return false;
  }
  return true;
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

interface ParsedStdout {
  text: string;
  result?: string;
  vars?: Record<string, string>;
}

function parseStdout(stdout: string): ParsedStdout {
  let rest = stdout;
  let vars: Record<string, string> | undefined;

  const sliceMarker = (begin: string, end: string): string | undefined => {
    const b = rest.indexOf(begin);
    if (b === -1) return undefined;
    const e = rest.indexOf(end, b + begin.length);
    if (e === -1) return undefined;
    const inner = rest.slice(b + begin.length, e);
    rest = rest.slice(0, b) + rest.slice(e + end.length);
    return inner;
  };

  const result = sliceMarker(RESULT_BEGIN, RESULT_END);
  const varsJson = sliceMarker(VARS_BEGIN, VARS_END);
  if (varsJson) {
    try {
      const parsed: unknown = JSON.parse(varsJson);
      if (parsed && typeof parsed === "object") {
        vars = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          vars[k] = JSON.stringify(v);
        }
      }
    } catch {
      // If json_encode produced something we can't parse (e.g. non-JSON-able
      // values), drop the vars panel rather than fail the whole run.
    }
  }

  return { text: rest, result, vars };
}
