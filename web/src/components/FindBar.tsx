import { useEffect, useMemo, useRef, useState } from "react";
import "./FindBar.css";

interface Props {
  /** Whether the bar is visible. Owner toggles this via the menu listener. */
  open: boolean;
  onClose: () => void;
}

const HIGHLIGHT_ALL = "shippable-find";
const HIGHLIGHT_CURRENT = "shippable-find-current";

// CSS Custom Highlight API: available on macOS WKWebView 17.2+ (macOS Sonoma).
// We treat its absence as "no highlighting" rather than blocking the feature —
// the count still works, scrolling still works.
function hasHighlightApi(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS;
}

function findRanges(query: string): Range[] {
  if (!query) return [];
  const root = document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(".find-bar")) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
        return NodeFilter.FILTER_REJECT;
      }
      // Cheap visibility check — offsetParent is null for display:none.
      // We accept hidden inputs etc; they have no text anyway.
      if ((parent as HTMLElement).offsetParent === null && parent !== document.body) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const ranges: Range[] = [];
  const needle = query.toLowerCase();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? "";
    if (!text) continue;
    const hay = text.toLowerCase();
    let i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + query.length);
      ranges.push(r);
      i += query.length;
    }
  }
  return ranges;
}

function setHighlight(name: string, ranges: Range[]) {
  if (!hasHighlightApi()) return;
  // @ts-expect-error — Highlight is a Web API, TS DOM lib doesn't ship it yet.
  const hl = new Highlight(...ranges);
  // @ts-expect-error — see above
  CSS.highlights.set(name, hl);
}

function clearHighlight(name: string) {
  if (!hasHighlightApi()) return;
  // @ts-expect-error — see above
  CSS.highlights.delete(name);
}

function scrollRangeIntoView(range: Range) {
  const el =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function FindBar({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const ranges = useMemo(() => (open ? findRanges(query) : []), [open, query]);
  const safeCurrent = ranges.length > 0 ? Math.min(current, ranges.length - 1) : 0;

  // "All" highlight tracks the full match set.
  useEffect(() => {
    if (!open) {
      clearHighlight(HIGHLIGHT_ALL);
      clearHighlight(HIGHLIGHT_CURRENT);
      return;
    }
    setHighlight(HIGHLIGHT_ALL, ranges);
    return () => {
      clearHighlight(HIGHLIGHT_ALL);
      clearHighlight(HIGHLIGHT_CURRENT);
    };
  }, [open, ranges]);

  // "Current" highlight + scroll follow the cursor.
  useEffect(() => {
    if (!open || ranges.length === 0) {
      clearHighlight(HIGHLIGHT_CURRENT);
      return;
    }
    setHighlight(HIGHLIGHT_CURRENT, [ranges[safeCurrent]]);
    scrollRangeIntoView(ranges[safeCurrent]);
  }, [open, ranges, safeCurrent]);

  // Focus + select on open so retyping a new query is one keypress.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  function moveCurrent(delta: number) {
    if (ranges.length === 0) return;
    setCurrent((safeCurrent + delta + ranges.length) % ranges.length);
  }

  if (!open) return null;

  return (
    <div className="find-bar" role="search" aria-label="Find on page">
      <input
        ref={inputRef}
        className="find-bar__input"
        type="search"
        placeholder="Find on page"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCurrent(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            moveCurrent(e.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="find-bar__count">
        {query.length === 0
          ? ""
          : ranges.length === 0
            ? "0/0"
            : `${safeCurrent + 1}/${ranges.length}`}
      </span>
      <button
        type="button"
        className="find-bar__btn"
        aria-label="Previous match"
        onClick={() => moveCurrent(-1)}
        disabled={ranges.length === 0}
      >
        ↑
      </button>
      <button
        type="button"
        className="find-bar__btn"
        aria-label="Next match"
        onClick={() => moveCurrent(1)}
        disabled={ranges.length === 0}
      >
        ↓
      </button>
      <button
        type="button"
        className="find-bar__btn find-bar__close"
        aria-label="Close find"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
