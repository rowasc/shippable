import "./CodeRunner.css";
import { useEffect, useRef, useState } from "react";
import { detectLang, parseSelection } from "../runner/parseInputs";
import type { Lang, ParsedSelection } from "../runner/parseInputs";
import { runJs } from "../runner/executeJs";
import type { RunResult } from "../runner/executeJs";
import { runPhp } from "../runner/executePhp";

interface Props {
  currentFilePath: string;
}

interface Anchor {
  top: number;
  left: number;
}

export function CodeRunner({ currentFilePath }: Props) {
  const lang: Lang | null = detectLang(currentFilePath);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [parsed, setParsed] = useState<ParsedSelection | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Mirror `expanded` into a ref so the selectionchange listener can read the
  // current value without re-subscribing on every render.
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  // Watch the selection. Only react to selections anchored inside the diff
  // body — clicks in the sidebar or inspector shouldn't open the runner.
  // Once the panel is expanded, ignore selection collapses (clicking inside
  // the panel collapses the document selection but shouldn't dismiss the
  // panel — Escape / the close button do that).
  useEffect(() => {
    if (!lang) return;

    function onSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return hide();
      const text = sel.toString();
      if (!text.trim() || text.length < 2) return hide();

      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer as Node;
      if (!isInsideDiff(container)) return hide();
      // Don't trigger when selection is inside the runner itself.
      if (panelRef.current && panelRef.current.contains(container as Node)) return;

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return hide();

      setAnchor({ top: rect.top + window.scrollY, left: rect.right + window.scrollX + 8 });
      const p = parseSelection(cleanSelection(text), lang!);
      setParsed(p);
      setInputs((prev) => {
        const next: Record<string, string> = {};
        for (const s of p.slots) next[s] = prev[s] ?? "";
        return next;
      });
      setResult(null);
    }

    function hide() {
      if (expandedRef.current) return;
      setAnchor(null);
      setParsed(null);
      setExpanded(false);
      setResult(null);
    }

    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [lang]);

  // Swallow Escape while the panel is open so it doesn't get swallowed by the
  // app's global keymap first.
  useEffect(() => {
    if (!anchor) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAnchor(null);
        setExpanded(false);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [anchor]);

  if (!lang || !anchor || !parsed) return null;

  const hasSlots = parsed.slots.length > 0;

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

  return (
    <div
      ref={panelRef}
      className={`coderunner ${expanded ? "coderunner--open" : "coderunner--pill"}`}
      style={{ top: anchor.top, left: anchor.left }}
      // Prevent mousedown from collapsing the text selection or shifting
      // focus — that would fire selectionchange and hide the panel. The click
      // event still fires on mouseup. Inputs are exempted so users can still
      // place the caret.
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") e.preventDefault();
      }}
    >
      {!expanded ? (
        <button
          className="coderunner__pill"
          onClick={() => setExpanded(true)}
          title={`run this ${parsed.lang} selection`}
        >
          ▷ run {parsed.lang}
          {hasSlots && <span className="coderunner__pill-slots">({parsed.slots.length})</span>}
        </button>
      ) : (
        <div className="coderunner__panel">
          <header className="coderunner__head">
            <span className="coderunner__lang">{parsed.lang}</span>
            <span className="coderunner__shape">
              {parsed.shape.kind === "anon-fn"
                ? "anonymous function"
                : parsed.shape.kind === "named-fn"
                  ? `function ${parsed.shape.name}`
                  : "free statements"}
            </span>
            <span className="coderunner__spacer" />
            <button className="coderunner__close" onClick={() => setExpanded(false)} title="collapse">
              –
            </button>
          </header>

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
                    placeholder={parsed.lang === "php" ? "e.g. 2 or \"hi\"" : "e.g. 2 or \"hi\""}
                    onChange={(e) =>
                      setInputs((prev) => ({ ...prev, [name]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onRun();
                    }}
                    autoFocus={name === parsed.slots[0]}
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="coderunner__nohint">no inputs detected — run as-is</div>
          )}

          <div className="coderunner__actions">
            <button
              className="coderunner__run"
              disabled={running}
              onClick={onRun}
            >
              {running ? "running…" : "▷ run"}
            </button>
            <span className="coderunner__hint">
              {parsed.lang === "php"
                ? "PHP 8.3 · WASM"
                : "sandboxed iframe · 2s timeout"}
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
      )}
    </div>
  );
}

function isInsideDiff(node: Node): boolean {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLElement) {
      if (el.classList?.contains("diff") || el.closest?.(".diff")) return true;
      if (el.classList?.contains("coderunner") || el.closest?.(".coderunner")) return false;
    }
    el = el.parentNode;
  }
  return false;
}

function cleanSelection(text: string): string {
  // The diff view prepends line numbers and ±/space markers via separate
  // spans. When the browser serializes a multi-line selection it joins them
  // with newlines, so we see lines like:
  //   "  9    \n \nfunction ($a) {"
  // Strip leading old/new line-number columns if present: numbers + whitespace
  // at the start of a line, followed by a sign column (+, -, or blank).
  const lines = text.split("\n").map((line) => {
    // Drop up to two leading "number or blank" columns, then one sign column.
    return line.replace(/^\s*\d*\s+\d*\s*[+\-\s]?/, "");
  });
  return lines.join("\n").trim();
}

function renderLog(l: string): string {
  // Prefixed by kind (log/warn/err/out) — strip the prefix for display.
  const m = /^(log|warn|err|out)\s(.*)$/s.exec(l);
  return m ? m[2] : l;
}
