import "./RichText.css";
import type { Cursor } from "../types";
import type { SymbolIndex } from "../symbols";
import { SyntaxBlock } from "./SyntaxBlock";

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
  const blocks = tokenizeBlocks(text);
  return (
    <div className="rt">
      {blocks.map((block, i) =>
        block.kind === "code" ? (
          <div key={i} className="rt__block">
            <SyntaxBlock code={block.code} language={block.language} />
          </div>
        ) : (
          <div key={i} className="rt__paragraph">
            {tokenize(block.text, symbols).map((part, partIdx) =>
              renderPart(part, `${i}-${partIdx}`, symbols, onJump),
            )}
          </div>
        ),
      )}
    </div>
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

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "code"; language?: string; code: string };

const IDENT_RE = /([A-Za-z_$][A-Za-z0-9_$]*)/g;
const TICK_RE = /`([^`]+)`/g;
const FENCE_RE = /```([\w.+-]+)?\n([\s\S]*?)```/g;

function renderPart(
  part: Part,
  key: string,
  symbols: SymbolIndex,
  onJump: (c: Cursor) => void,
) {
  if (part.kind === "text") return <span key={key}>{part.text}</span>;
  if (part.kind === "code") {
    const target = symbols.get(part.text.trim());
    if (target) {
      return (
        <SymbolLink
          key={key}
          name={part.text}
          target={target}
          onJump={onJump}
          code
        />
      );
    }
    return <code key={key} className="rt-code">{part.text}</code>;
  }
  return (
    <SymbolLink
      key={key}
      name={part.text}
      target={part.target}
      onJump={onJump}
    />
  );
}

function tokenizeBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let lastEnd = 0;

  for (const match of text.matchAll(FENCE_RE)) {
    const start = match.index ?? 0;
    if (start > lastEnd) {
      pushParagraphBlocks(blocks, text.slice(lastEnd, start));
    }

    blocks.push({
      kind: "code",
      language: match[1],
      code: stripTrailingNewline(match[2]),
    });
    lastEnd = start + match[0].length;
  }

  if (lastEnd < text.length) {
    pushParagraphBlocks(blocks, text.slice(lastEnd));
  }

  return blocks.length > 0 ? blocks : [{ kind: "paragraph", text }];
}

function pushParagraphBlocks(blocks: Block[], text: string) {
  const normalized = text.replace(/^\n+|\n+$/g, "");
  if (!normalized) return;

  for (const paragraph of normalized.split(/\n{2,}/)) {
    if (paragraph) blocks.push({ kind: "paragraph", text: paragraph });
  }
}

function stripTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

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
