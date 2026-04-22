import type { Cursor } from "../types";
import type { SymbolIndex } from "../symbols";

interface Props {
  text: string;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
}

/**
 * Renders prose with two conveniences:
 *   - `backtick spans` become <code>, and if the span is a single known
 *     identifier, it's also clickable.
 *   - Bare identifiers that match a known symbol become clickable chips.
 */
export function RichText({ text, symbols, onJump }: Props) {
  const parts = tokenize(text, symbols);
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "text") return <span key={i}>{p.text}</span>;
        if (p.kind === "code") {
          const target = symbols.get(p.text.trim());
          if (target) {
            return (
              <SymbolLink
                key={i}
                name={p.text}
                target={target}
                onJump={onJump}
                code
              />
            );
          }
          return <code key={i} className="rt-code">{p.text}</code>;
        }
        return (
          <SymbolLink
            key={i}
            name={p.text}
            target={p.target}
            onJump={onJump}
          />
        );
      })}
    </>
  );
}

function SymbolLink({
  name,
  target,
  onJump,
  code,
}: {
  name: string;
  target: Cursor;
  onJump: (c: Cursor) => void;
  code?: boolean;
}) {
  return (
    <button
      className={`sym ${code ? "sym--code" : ""}`}
      onClick={() => onJump(target)}
      title={`jump to ${name}`}
    >
      {name}
    </button>
  );
}

type Part =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "symbol"; text: string; target: Cursor };

const IDENT_RE = /([A-Za-z_$][A-Za-z0-9_$]*)/g;
const TICK_RE = /`([^`]+)`/g;

function tokenize(text: string, symbols: SymbolIndex): Part[] {
  const parts: Part[] = [];
  let lastEnd = 0;
  for (const m of text.matchAll(TICK_RE)) {
    const start = m.index ?? 0;
    if (start > lastEnd) {
      parts.push(...scanPlain(text.slice(lastEnd, start), symbols));
    }
    parts.push({ kind: "code", text: m[1] });
    lastEnd = start + m[0].length;
  }
  if (lastEnd < text.length) {
    parts.push(...scanPlain(text.slice(lastEnd), symbols));
  }
  return parts;
}

function scanPlain(text: string, symbols: SymbolIndex): Part[] {
  const out: Part[] = [];
  let lastEnd = 0;
  for (const m of text.matchAll(IDENT_RE)) {
    const start = m.index ?? 0;
    const name = m[1];
    const target = symbols.get(name);
    if (!target) continue;
    if (start > lastEnd) {
      out.push({ kind: "text", text: text.slice(lastEnd, start) });
    }
    out.push({ kind: "symbol", text: name, target });
    lastEnd = start + name.length;
  }
  if (lastEnd < text.length) {
    out.push({ kind: "text", text: text.slice(lastEnd) });
  }
  return out;
}
