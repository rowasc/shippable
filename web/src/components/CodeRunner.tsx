import "./CodeRunner.css";
import { useEffect, useMemo, useState } from "react";
import { detectLang, parseSelection, placeholderFor } from "../runner/parseInputs";
import type { Lang } from "../runner/parseInputs";
import { runJs } from "../runner/executeJs";
import type { RunResult } from "../runner/executeJs";
import { runPhp } from "../runner/executePhp";

interface Props {
  currentFilePath: string;
  /** Parent-controlled: when true, open the panel as a free-style runner
   *  (no selection required, source starts empty, edit mode by default). */
  freeOpen: boolean;
  onFreeClose: () => void;
  /**
   * Bumps whenever the user opens the runner with a specific snippet —
   * either via `e` (cursor / block selection) or via a `▷ verify`
   * button on an AI note. When `inputs` is provided, the slot map is
   * pre-filled — parent only supplies it for AI verifies; `e` leaves
   * it undefined and the runner starts with an empty input map.
   */
  runRequest: {
    tick: number;
    source: string;
    inputs?: Record<string, string>;
  } | null;
}

type Mode = "guided" | "edit";

interface Anchor {
  top: number;
  left: number;
}

/**
 * Two ways the panel opens:
 *  - selection-driven: `anchor` set by the diff click; source starts as the
 *    selected text; mode defaults to "guided".
 *  - free runner: `anchor` null (panel renders centered-ish near the topbar);
 *    source starts empty; mode forced to "edit" until the user has something
 *    to run.
 */
interface OpenState {
  source: string;
  anchor: Anchor | null;
  isFree: boolean;
}

const FREE_RUNNER_STARTER_TS = "// type or paste a snippet, then press ▷ run\n";
const FREE_RUNNER_STARTER_PHP = "// type or paste PHP, then press ▷ run\n";

export function CodeRunner({
  currentFilePath,
  freeOpen,
  onFreeClose,
  runRequest,
}: Props) {
  // Detected language drives the runner choice and the placeholder hints.
  // Free runner falls back to TS when the current file isn't a known
  // language (so opening the runner from anywhere still works).
  const detectedLang: Lang | null = detectLang(currentFilePath);
  const lang: Lang = detectedLang ?? "ts";

  const [open, setOpen] = useState<OpenState | null>(null);
  const [mode, setMode] = useState<Mode>("guided");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  // Re-parse on every source change. Cheap (regex-based) so it's fine to
  // run inline; the editor benefits from live shape detection.
  const parsed = useMemo(
    () => (open ? parseSelection(open.source, lang) : null),
    [open, lang],
  );

  // Inputs is a sticky map keyed by slot name. We never reconcile when the
  // slot set changes — render just looks up `inputs[slot] ?? ""`, so stale
  // entries are harmless. (Skipping the reconcile avoids a cascading
  // setState during render.)

  // Keyboard-driven open: App bumps runRequest.tick when the reviewer
  // presses `e`, and supplies the snippet pulled from the diff cursor /
  // block selection. We don't read window.getSelection here — the gesture
  // is keyboard-first, the user shouldn't have to mouse-drag to use it.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!runRequest || runRequest.tick === 0) return;
    if (!detectedLang) return;
    const trimmed = runRequest.source.trim();
    if (trimmed.length < 2) return;
    setOpen({
      source: runRequest.source,
      // anchor:null pins the panel near the topbar. Without a live DOM
      // range we have nothing to anchor to, and chasing the cursor row
      // would fight scroll position.
      anchor: null,
      isFree: false,
    });
    setMode("guided");
    setResult(null);
    // Pre-fill the slot map when the request brought inputs (AI verify).
    // Plain `e` requests omit `inputs` and we leave the existing sticky
    // map alone — the user may have typed values for the previous run.
    if (runRequest.inputs) setInputs(runRequest.inputs);
  }, [runRequest, detectedLang]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Parent-driven free runner: when freeOpen flips true, open the panel
  // with an empty source and edit mode forced on. Cascading setState here
  // is intentional — the prop is the trigger; the rule's "you might not
  // need an effect" alternative would mean lifting more state into App.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!freeOpen) return;
    setOpen({
      source: lang === "php" ? FREE_RUNNER_STARTER_PHP : FREE_RUNNER_STARTER_TS,
      anchor: null,
      isFree: true,
    });
    setMode("edit");
    setResult(null);
  }, [freeOpen, lang]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Escape closes the panel. Inlined rather than calling closePanel() so
  // the effect dep list stays { open } and doesn't pull a non-stable
  // function reference in.
  useEffect(() => {
    if (!open) return;
    const wasFree = open.isFree;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(null);
      setResult(null);
      if (wasFree) onFreeClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onFreeClose]);

  function closePanel() {
    setOpen(null);
    setResult(null);
    if (open?.isFree) onFreeClose();
  }

  async function onRun() {
    if (!parsed) return;
    setRunning(true);
    setResult(null);
    try {
      const r =
        parsed.lang === "php"
          ? await runPhp(parsed, inputs)
          : await runJs(parsed, inputs);
      setResult(r);
    } finally {
      setRunning(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────

  if (!open || !parsed) return null;

  const hasSlots = parsed.slots.length > 0;
  const panelStyle: React.CSSProperties = open.anchor
    ? { top: open.anchor.top, left: open.anchor.left, position: "absolute" }
    : { position: "fixed", top: 56, right: 24 };

  return (
    <div
      className={`coderunner coderunner--open ${open.isFree ? "coderunner--free" : ""}`}
      style={panelStyle}
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") e.preventDefault();
      }}
    >
      <div className="coderunner__panel">
        <header className="coderunner__head">
          <span className="coderunner__lang">{parsed.lang}</span>
          <span className="coderunner__shape">
            {open.isFree
              ? "free runner"
              : parsed.shape.kind === "anon-fn"
                ? "anonymous function"
                : parsed.shape.kind === "named-fn"
                  ? `function ${parsed.shape.name}`
                  : "free statements"}
          </span>
          <span className="coderunner__spacer" />
          <div className="coderunner__modes" role="tablist">
            <button
              role="tab"
              aria-selected={mode === "guided"}
              className={`coderunner__mode ${mode === "guided" ? "coderunner__mode--on" : ""}`}
              onClick={() => setMode("guided")}
              title="guided: read-only snippet, fill the input form"
            >
              guided
            </button>
            <button
              role="tab"
              aria-selected={mode === "edit"}
              className={`coderunner__mode ${mode === "edit" ? "coderunner__mode--on" : ""}`}
              onClick={() => setMode("edit")}
              title="edit: edit the snippet itself; inputs detect on the fly"
            >
              edit
            </button>
          </div>
          <button className="coderunner__close" onClick={closePanel} title="close (Esc)">
            ×
          </button>
        </header>

        {/* Source area — read-only in guided mode, editable textarea in edit mode. */}
        {mode === "edit" ? (
          <textarea
            className="coderunner__source-edit"
            spellCheck={false}
            autoFocus={open.isFree}
            value={open.source}
            placeholder={lang === "php" ? "// PHP source\n<?php …" : "// JS / TS source\n(a, b) => a + b"}
            onChange={(e) => setOpen({ ...open, source: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onRun();
              }
            }}
          />
        ) : (
          <pre className="coderunner__source-view">{open.source.trim()}</pre>
        )}

        {hasSlots ? (
          <div className="coderunner__inputs">
            {parsed.slots.map((name) => (
              <label key={name} className="coderunner__input">
                <span className="coderunner__input-name">
                  {parsed.lang === "php" ? "$" : ""}
                  {name}
                </span>
                <input
                  className="coderunner__input-box"
                  value={inputs[name] ?? ""}
                  placeholder={placeholderFor(name)}
                  onChange={(e) =>
                    setInputs((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onRun();
                  }}
                  // Only autofocus when source is read-only — in edit mode
                  // every keystroke re-derives slots, mounting fresh
                  // inputs whose autoFocus would steal from the textarea.
                  autoFocus={mode === "guided" && !open.isFree && name === parsed.slots[0]}
                />
              </label>
            ))}
          </div>
        ) : (
          <div className="coderunner__nohint">
            {open.source.trim()
              ? "ready to run — no inputs needed"
              : "type a snippet above"}
          </div>
        )}

        <div className="coderunner__actions">
          <button
            className="coderunner__run"
            disabled={running || !open.source.trim()}
            onClick={onRun}
          >
            {running ? "running…" : "▷ run"}
          </button>
          <span className="coderunner__hint">
            {parsed.lang === "php"
              ? "PHP 8.3 · WASM"
              : "sandboxed iframe · 2s timeout"}
            {mode === "edit" && (
              <span className="coderunner__hint-extra"> · ⌘+enter to run</span>
            )}
          </span>
        </div>

        {result && (
          <div className={`coderunner__out ${result.ok ? "" : "coderunner__out--err"}`}>
            {result.logs.length > 0 && (
              <pre className="coderunner__logs">
                {result.logs.map((l) => renderLog(l)).join("\n")}
              </pre>
            )}
            {result.result !== undefined && (
              <pre className="coderunner__return">
                <span className="coderunner__label">return</span> {result.result}
              </pre>
            )}
            {result.vars && Object.keys(result.vars).length > 0 && (
              <div className="coderunner__vars">
                <span className="coderunner__label">vars</span>
                {Object.entries(result.vars).map(([k, v]) => (
                  <div key={k} className="coderunner__var">
                    <span className="coderunner__var-name">
                      {parsed.lang === "php" ? "$" : ""}
                      {k}
                    </span>
                    <span className="coderunner__var-eq">=</span>
                    <span className="coderunner__var-val">{v}</span>
                  </div>
                ))}
              </div>
            )}
            {result.error && (
              <pre className="coderunner__err">
                <span className="coderunner__label">error</span> {result.error}
              </pre>
            )}
            {result.ok &&
              result.logs.length === 0 &&
              result.result === undefined &&
              (!result.vars || Object.keys(result.vars).length === 0) && (
                <span className="coderunner__empty">(no output)</span>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

function renderLog(l: string): string {
  const m = /^(log|warn|err|out)\s(.*)$/s.exec(l);
  return m ? m[2] : l;
}
