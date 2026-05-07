import "./DiffView.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { highlightLines } from "../highlight";
import type { DefinitionClickTarget } from "../definitionNav";
import type { DiffLine } from "../types";
import type {
  DiffLineViewModel,
  DiffViewModel,
  ExpandBarViewModel,
  FullFileLineViewModel,
  HunkViewModel,
} from "../view";
import { MarkdownView } from "./MarkdownView";

/**
 * Mouse interactions on the diff body. Callbacks fire from a single delegated
 * handler on each hunk's `<div className="hunk__body">`, disambiguated by
 * which column of the line grid the gesture started in:
 *   - gutter columns (line numbers / sign / AI glyph)  → drag picks line range
 *   - line text content                                → browser native text
 *                                                       selection; capture as
 *                                                       charRange on mouseup
 *   - syntax-highlighted [data-symbol]                  → falls through to the
 *                                                       existing symbol-jump
 *                                                       click handler in
 *                                                       LineText
 *
 * The grid template `40px 40px 14px 16px 1fr` in DiffView.css is the contract
 * that makes this disambiguation unambiguous — only the trailing 1fr column
 * carries `.line__text`, and only that column should let the browser select.
 */
export interface DiffViewMouseHandlers {
  /**
   * Click placed (or about to place) the cursor on this line. `extend` is
   * true when the user is holding Shift. Caller decides whether to keep or
   * collapse selection — we don't reach into reducer semantics here.
   */
  onLineFocus?: (hunkId: string, lineIdx: number, opts: { extend: boolean }) => void;
  /**
   * Drag is updating a line-range selection. Anchor and head are both within
   * `hunkId` and reflect the most recent move tick. Cursor should follow
   * `head` so the read-track lands wherever the drag points.
   */
  onLineSelectRange?: (hunkId: string, anchor: number, head: number) => void;
  /**
   * Native browser text selection ended on a single line. UTF-16 offsets
   * relative to the `.line__text` element's concatenated textContent.
   */
  onLineCharSelect?: (
    hunkId: string,
    lineIdx: number,
    fromCol: number,
    toCol: number,
  ) => void;
  /** Right-click. Caller decides whether to move cursor based on selection. */
  onLineContextMenu?: (
    hunkId: string,
    lineIdx: number,
    clientX: number,
    clientY: number,
  ) => void;
}

interface Props extends DiffViewMouseHandlers {
  viewModel: DiffViewModel;
  onSetExpandLevel: (hunkId: string, dir: "above" | "below", level: number) => void;
  onToggleExpandFile: (fileId: string) => void;
  onTogglePreviewFile: (fileId: string) => void;
  clickableSymbols?: ReadonlySet<string>;
  allowAnyIdentifier?: boolean;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
  /**
   * When false, mouse interaction props are ignored — used to disable the
   * line-level pointer plumbing while a modal owns input. The symbol click
   * path inside LineText is unaffected.
   */
  interactionsEnabled?: boolean;
}

type DragState =
  | {
      kind: "lineRange";
      hunkId: string;
      anchorLineIdx: number;
      headLineIdx: number;
      pointerId: number;
      capturedOn: Element | null;
    }
  | {
      kind: "text";
      hunkId: string;
      anchorLineIdx: number;
      shiftKey: boolean;
    };

export function DiffView({
  viewModel,
  onSetExpandLevel,
  onToggleExpandFile,
  onTogglePreviewFile,
  clickableSymbols,
  allowAnyIdentifier,
  onSymbolClick,
  onLineFocus,
  onLineSelectRange,
  onLineCharSelect,
  onLineContextMenu,
  interactionsEnabled = true,
}: Props) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const edgeScrollRef = useRef<{
    rafId: number;
    x: number;
    y: number;
    container: HTMLElement | Window;
  } | null>(null);

  const stopEdgeScroll = () => {
    const ref = edgeScrollRef.current;
    if (!ref) return;
    cancelAnimationFrame(ref.rafId);
    edgeScrollRef.current = null;
  };

  // Drag past the viewport edge: scroll the nearest scrollable ancestor while
  // the pointer hovers in the edge band, and re-resolve the lineEl underneath
  // each tick so the selection head keeps following the (now scrolled) line.
  const startEdgeScroll = (x: number, y: number, container: HTMLElement | Window) => {
    if (edgeScrollRef.current) {
      edgeScrollRef.current.x = x;
      edgeScrollRef.current.y = y;
      return;
    }
    const tick = () => {
      const ref = edgeScrollRef.current;
      const drag = dragRef.current;
      if (!ref || !drag || drag.kind !== "lineRange") {
        stopEdgeScroll();
        return;
      }
      const EDGE = 50;
      const MAX_SPEED = 16;
      let dy = 0;
      if (ref.y < EDGE) dy = -MAX_SPEED * Math.min(1, (EDGE - ref.y) / EDGE);
      else if (ref.y > window.innerHeight - EDGE)
        dy = MAX_SPEED * Math.min(1, (ref.y - (window.innerHeight - EDGE)) / EDGE);
      if (dy !== 0) {
        if (ref.container instanceof Window) ref.container.scrollBy(0, dy);
        else ref.container.scrollBy({ top: dy });
        const el = document.elementFromPoint(ref.x, ref.y);
        const lineEl = el?.closest<HTMLElement>("[data-line-idx]");
        const hunkEl = lineEl?.closest<HTMLElement>("[data-hunk-id]");
        if (lineEl && hunkEl && hunkEl.dataset.hunkId === drag.hunkId) {
          const lineIdx = Number(lineEl.dataset.lineIdx);
          if (Number.isFinite(lineIdx) && lineIdx !== drag.headLineIdx) {
            drag.headLineIdx = lineIdx;
            onLineSelectRange?.(drag.hunkId, drag.anchorLineIdx, lineIdx);
          }
        }
      }
      ref.rafId = requestAnimationFrame(tick);
    };
    edgeScrollRef.current = {
      rafId: requestAnimationFrame(tick),
      x,
      y,
      container,
    };
  };

  const handlersEnabled =
    interactionsEnabled &&
    !!(onLineFocus || onLineSelectRange || onLineCharSelect || onLineContextMenu);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!handlersEnabled || event.button !== 0) return;
    const target = event.target as HTMLElement;
    const lineEl = target.closest<HTMLElement>("[data-line-idx]");
    const hunkEl = lineEl?.closest<HTMLElement>("[data-hunk-id]");
    if (!lineEl || !hunkEl) return;
    const lineIdx = Number(lineEl.dataset.lineIdx);
    const hunkId = hunkEl.dataset.hunkId!;
    if (!Number.isFinite(lineIdx)) return;

    // Symbol click wins — the existing LineText handler does jump-to-def.
    if (target.closest("[data-symbol]")) return;

    if (target.closest(".line__text")) {
      // Defer to native text selection. Decision (focus vs char-range) is
      // made on pointerup once we know if the user dragged.
      dragRef.current = {
        kind: "text",
        hunkId,
        anchorLineIdx: lineIdx,
        shiftKey: event.shiftKey,
      };
      return;
    }

    // Gutter — own the gesture. Suppress text selection, take pointer
    // capture so moves outside child elements still update head.
    event.preventDefault();
    const captureTarget = event.currentTarget;
    try {
      captureTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and some browsers throw if the pointer isn't capturable; the
      // handler still works without capture, just less robustly.
    }
    dragRef.current = {
      kind: "lineRange",
      hunkId,
      anchorLineIdx: lineIdx,
      headLineIdx: lineIdx,
      pointerId: event.pointerId,
      capturedOn: captureTarget,
    };
    onLineFocus?.(hunkId, lineIdx, { extend: event.shiftKey });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== "lineRange") return;
    const EDGE = 50;
    const inEdgeBand =
      event.clientY < EDGE || event.clientY > window.innerHeight - EDGE;
    if (inEdgeBand) {
      const container = findScrollContainer(event.currentTarget);
      startEdgeScroll(event.clientX, event.clientY, container);
    } else {
      stopEdgeScroll();
    }
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el) return;
    const lineEl = el.closest<HTMLElement>("[data-line-idx]");
    const hunkEl = lineEl?.closest<HTMLElement>("[data-hunk-id]");
    if (!lineEl || !hunkEl) return;
    if (hunkEl.dataset.hunkId !== drag.hunkId) return; // clamp at hunk boundary
    const lineIdx = Number(lineEl.dataset.lineIdx);
    if (!Number.isFinite(lineIdx) || lineIdx === drag.headLineIdx) return;
    drag.headLineIdx = lineIdx;
    onLineSelectRange?.(drag.hunkId, drag.anchorLineIdx, lineIdx);
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    stopEdgeScroll();

    if (drag.kind === "lineRange") {
      try {
        drag.capturedOn?.releasePointerCapture(drag.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    // Text branch: examine native selection on this same gesture.
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      onLineFocus?.(drag.hunkId, drag.anchorLineIdx, { extend: drag.shiftKey });
      return;
    }
    const result = readNativeCharSelection(sel);
    if (!result) {
      onLineFocus?.(drag.hunkId, drag.anchorLineIdx, { extend: drag.shiftKey });
      return;
    }
    if (result.kind === "single") {
      // Same hunk check — if the user managed to drag into another hunk's
      // text, fall back to a line-range selection.
      if (result.hunkId !== drag.hunkId) {
        sel.removeAllRanges();
        return;
      }
      onLineCharSelect?.(result.hunkId, result.lineIdx, result.fromCol, result.toCol);
      return;
    }
    // Multi-line text drag — discard the native highlight and emit a line
    // range selection within the originating hunk. If the drag escapes the
    // hunk we just bail; charRange is single-line by shape.
    sel.removeAllRanges();
    if (result.hunkId !== drag.hunkId) return;
    onLineSelectRange?.(result.hunkId, result.anchorLineIdx, result.headLineIdx);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!handlersEnabled) return;
    const target = event.target as HTMLElement;
    const lineEl = target.closest<HTMLElement>("[data-line-idx]");
    const hunkEl = lineEl?.closest<HTMLElement>("[data-hunk-id]");
    if (!lineEl || !hunkEl) return;
    const lineIdx = Number(lineEl.dataset.lineIdx);
    const hunkId = hunkEl.dataset.hunkId!;
    if (!Number.isFinite(lineIdx)) return;
    event.preventDefault();
    onLineContextMenu?.(hunkId, lineIdx, event.clientX, event.clientY);
  };

  const lineMouseHandlers = handlersEnabled
    ? {
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onContextMenu: handleContextMenu,
      }
    : undefined;

  // Derive the current hunk id and cursor line idx from the view model for the
  // scroll effect — we need to know when the cursor moves.
  const currentHunk = viewModel.hunks.find((h) => h.isCurrent);
  const cursorLineIdx = currentHunk?.lines.findIndex((l) => l.isCursor) ?? -1;

  useEffect(() => {
    if (!viewModel.fileFullyExpanded && !viewModel.filePreviewing)
      cursorRef.current?.scrollIntoView({ block: "nearest" });
  }, [
    currentHunk?.id,
    cursorLineIdx,
    viewModel.fileId,
    viewModel.fileFullyExpanded,
    viewModel.filePreviewing,
  ]);

  const mode: "diff" | "fullsource" | "preview" = viewModel.filePreviewing
    ? "preview"
    : viewModel.fileFullyExpanded
      ? "fullsource"
      : "diff";

  return (
    <main className={`diff ${viewModel.isFileReviewed ? "diff--file-reviewed" : ""}`}>
      <header className="diff__path">
        <span className="diff__path-icon">▚</span> {viewModel.path}
        <span className="diff__path-status">[{viewModel.status}]</span>
        {viewModel.isFileReviewed && (
          <span className="diff__path-reviewed" title="signed off · Shift+M to clear">
            ✓ reviewed
          </span>
        )}
        <span className="diff__spacer" />
        {viewModel.canPreview ? (
          <ModeToggle
            mode={mode}
            canFullSource={viewModel.canExpandFile}
            onSelect={(next) => {
              if (next === mode) return;
              if (next === "preview") onTogglePreviewFile(viewModel.fileId);
              else if (next === "fullsource") onToggleExpandFile(viewModel.fileId);
              else if (mode === "preview") onTogglePreviewFile(viewModel.fileId);
              else onToggleExpandFile(viewModel.fileId);
            }}
          />
        ) : (
          viewModel.canExpandFile && (
            <button
              className={`diff__expand-file ${viewModel.fileFullyExpanded ? "diff__expand-file--on" : ""}`}
              onClick={() => onToggleExpandFile(viewModel.fileId)}
              title="expand / collapse entire file"
            >
              {viewModel.fileFullyExpanded ? "↙ collapse to hunks" : "↗ expand entire file"}
            </button>
          )
        )}
      </header>

      {viewModel.filePreviewing ? (
        <MarkdownView
          source={viewModel.previewSource}
          basePath={viewModel.path}
          imageAssets={viewModel.imageAssets}
        />
      ) : viewModel.fileFullyExpanded ? (
        <FullFileView
          path={viewModel.path}
          language={viewModel.language}
          lines={viewModel.fullFileLines}
          clickableSymbols={clickableSymbols}
          allowAnyIdentifier={allowAnyIdentifier}
          onSymbolClick={onSymbolClick}
        />
      ) : (
        viewModel.hunks.map((h) => (
          <HunkBlock
            key={h.id}
            hunk={h}
            path={viewModel.path}
            language={viewModel.language}
            onSetExpandLevel={(dir, level) => onSetExpandLevel(h.id, dir, level)}
            cursorRef={cursorRef}
            clickableSymbols={clickableSymbols}
            allowAnyIdentifier={allowAnyIdentifier}
            onSymbolClick={onSymbolClick}
            lineMouseHandlers={lineMouseHandlers}
          />
        ))
      )}
    </main>
  );
}

function ModeToggle({
  mode,
  canFullSource,
  onSelect,
}: {
  mode: "diff" | "fullsource" | "preview";
  canFullSource: boolean;
  onSelect: (next: "diff" | "fullsource" | "preview") => void;
}) {
  return (
    <div className="diff__mode" role="tablist" aria-label="View mode">
      <button
        role="tab"
        aria-selected={mode === "diff"}
        className={`diff__mode-btn ${mode === "diff" ? "diff__mode-btn--on" : ""}`}
        onClick={() => onSelect("diff")}
      >
        Diff
      </button>
      {canFullSource && (
        <button
          role="tab"
          aria-selected={mode === "fullsource"}
          className={`diff__mode-btn ${mode === "fullsource" ? "diff__mode-btn--on" : ""}`}
          onClick={() => onSelect("fullsource")}
        >
          Source
        </button>
      )}
      <button
        role="tab"
        aria-selected={mode === "preview"}
        className={`diff__mode-btn ${mode === "preview" ? "diff__mode-btn--on" : ""}`}
        onClick={() => onSelect("preview")}
      >
        Preview
      </button>
    </div>
  );
}

type LineMouseHandlerProps = {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
};

function HunkBlock({
  hunk,
  path,
  language,
  onSetExpandLevel,
  cursorRef,
  clickableSymbols,
  allowAnyIdentifier,
  onSymbolClick,
  lineMouseHandlers,
}: {
  hunk: HunkViewModel;
  path: string;
  language: string;
  onSetExpandLevel: (dir: "above" | "below", level: number) => void;
  cursorRef: React.RefObject<HTMLDivElement | null>;
  clickableSymbols?: ReadonlySet<string>;
  allowAnyIdentifier?: boolean;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
  lineMouseHandlers?: LineMouseHandlerProps;
}) {
  return (
    <section className={`hunk ${hunk.isCurrent ? "hunk--current" : ""}`}>
      <header className="hunk__h">
        <span className="hunk__meter">{Math.round(hunk.coverage * 100)}%</span>
        <span className="hunk__header-text">{hunk.header}</span>
        <span className="hunk__badges">
          {hunk.aiReviewed && <Badge kind="ai">AI ✓</Badge>}
          {hunk.teammateReview && (
            <Badge
              kind={hunk.teammateReview.verdict === "approve" ? "approve" : "comment"}
              title={hunk.teammateReview.note}
            >
              @{hunk.teammateReview.user}{" "}
              {hunk.teammateReview.verdict === "approve" ? "✓" : "💬"}
            </Badge>
          )}
          {hunk.definesSymbols.map((s) => (
            <Badge key={s} kind="symbol">def {s}</Badge>
          ))}
          {hunk.referencesSymbols.map((s) => (
            <Badge key={s} kind="ref">ref {s}</Badge>
          ))}
        </span>
      </header>

      {hunk.expandAbove && (
        <ExpandBar
          dir="above"
          bar={hunk.expandAbove}
          onExpand={() => onSetExpandLevel("above", hunk.expandAbove!.level + 1)}
          onCollapse={() => onSetExpandLevel("above", 0)}
        />
      )}
      {hunk.contextAbove.length > 0 && (
        <ContextLinesBlock
          path={path}
          lines={hunk.contextAbove}
          language={language}
          prefix="ea"
          clickableSymbols={clickableSymbols}
          allowAnyIdentifier={allowAnyIdentifier}
          onSymbolClick={onSymbolClick}
        />
      )}

      <HunkLinesBlock
        path={path}
        hunkId={hunk.id}
        lines={hunk.lines}
        language={language}
        cursorRef={cursorRef}
        clickableSymbols={clickableSymbols}
        allowAnyIdentifier={allowAnyIdentifier}
        onSymbolClick={onSymbolClick}
        lineMouseHandlers={lineMouseHandlers}
      />

      {hunk.contextBelow.length > 0 && (
        <ContextLinesBlock
          path={path}
          lines={hunk.contextBelow}
          language={language}
          prefix="eb"
          clickableSymbols={clickableSymbols}
          allowAnyIdentifier={allowAnyIdentifier}
          onSymbolClick={onSymbolClick}
        />
      )}
      {hunk.expandBelow && (
        <ExpandBar
          dir="below"
          bar={hunk.expandBelow}
          onExpand={() => onSetExpandLevel("below", hunk.expandBelow!.level + 1)}
          onCollapse={() => onSetExpandLevel("below", 0)}
        />
      )}
    </section>
  );
}

function ExpandBar({
  dir,
  bar,
  onExpand,
  onCollapse,
}: {
  dir: "above" | "below";
  bar: ExpandBarViewModel;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const arrow = dir === "above" ? "↑" : "↓";
  const hasMore = bar.level < bar.maxLevel;
  return (
    <div className="expandbar">
      {hasMore ? (
        <button className="expandbar__main" onClick={onExpand}>
          <span className="expandbar__arrow">{arrow}</span>{" "}
          expand {bar.nextSize} line{bar.nextSize === 1 ? "" : "s"} {dir} (to next block{" "}
          <span className="expandbar__lvl">
            {bar.level + 1}/{bar.maxLevel}
          </span>
          )
        </button>
      ) : (
        <span className="expandbar__main expandbar__main--done">
          <span className="expandbar__arrow">✓</span> all {bar.maxLevel} block
          {bar.maxLevel === 1 ? "" : "s"} {dir} revealed
        </span>
      )}
      {bar.level > 0 && (
        <button className="expandbar__collapse" onClick={onCollapse} title="collapse all">
          × collapse
        </button>
      )}
    </div>
  );
}

function ContextLine({
  filePath,
  language,
  line,
  highlightedHtml,
  onSymbolClick,
}: {
  filePath: string;
  language: string;
  line: DiffLine;
  highlightedHtml?: string;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
}) {
  return (
    <div className="line line--context line--ctx-expand">
      <span className="line__old">{line.oldNo ?? ""}</span>
      <span className="line__new">{line.newNo ?? ""}</span>
      <span className="line__ai" aria-hidden="true">{" "}</span>
      <span className="line__sign">{" "}</span>
      <LineText
        filePath={filePath}
        language={language}
        text={line.text}
        sourceLine={line.newNo ?? null}
        highlightedHtml={highlightedHtml}
        onSymbolClick={onSymbolClick}
      />
    </div>
  );
}

function FullFileView({
  path,
  language,
  lines,
  clickableSymbols,
  allowAnyIdentifier,
  onSymbolClick,
}: {
  path: string;
  language: string;
  lines: FullFileLineViewModel[];
  clickableSymbols?: ReadonlySet<string>;
  allowAnyIdentifier?: boolean;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
}) {
  const highlightedLines = useHighlightedLines(
    lines,
    language,
    clickableSymbols,
    allowAnyIdentifier,
  );
  return (
    <section className="hunk hunk--full">
      <header className="hunk__h">
        <span className="hunk__header-text">entire file · {path}</span>
      </header>
      <div className="hunk__body">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`line line--${line.kind} ${
              line.kind !== "context" ? "" : "line--ctx-expand"
            }`}
          >
            <span className="line__old">{line.oldNo ?? ""}</span>
            <span className="line__new">{line.newNo ?? ""}</span>
            <span className="line__ai" aria-hidden="true">{" "}</span>
            <span className="line__sign">{line.sign}</span>
            <LineText
              filePath={path}
              language={language}
              text={line.text}
              sourceLine={line.newNo ?? null}
              highlightedHtml={highlightedLines?.[i]}
              onSymbolClick={onSymbolClick}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function Line({
  filePath,
  language,
  line,
  lineIdx,
  highlightedHtml,
  cursorRef,
  onSymbolClick,
}: {
  filePath: string;
  language: string;
  line: DiffLineViewModel;
  lineIdx: number;
  highlightedHtml?: string;
  cursorRef?: React.RefObject<HTMLDivElement | null>;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
}) {
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  const sev = line.aiNote?.severity;
  return (
    <div
      ref={cursorRef}
      data-line-idx={lineIdx}
      className={`line line--${line.kind} ${line.isCursor ? "line--cursor" : ""} ${
        line.isRead ? "line--read" : ""
      } ${line.isSelected ? "line--selected" : ""} ${
        sev ? `line--ai-${sev}` : ""
      } ${line.isAcked ? "line--ai-acked" : ""} ${
        line.hasUserComment ? "line--has-comment" : ""
      }`}
      title={line.aiNote?.summary ?? (line.hasUserComment ? "user comment" : undefined)}
    >
      <span className="line__old">{line.oldNo ?? ""}</span>
      <span className="line__new">{line.newNo ?? ""}</span>
      <span className="line__ai" aria-hidden="true">
        {line.aiGlyph}
      </span>
      <span className="line__sign">{sign}</span>
      <LineText
        filePath={filePath}
        language={language}
        text={line.text}
        sourceLine={line.newNo ?? null}
        highlightedHtml={highlightedHtml}
        onSymbolClick={onSymbolClick}
      />
    </div>
  );
}

function ContextLinesBlock({
  path,
  lines,
  language,
  prefix,
  clickableSymbols,
  allowAnyIdentifier,
  onSymbolClick,
}: {
  path: string;
  lines: DiffLine[];
  language: string;
  prefix: string;
  clickableSymbols?: ReadonlySet<string>;
  allowAnyIdentifier?: boolean;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
}) {
  const highlightedLines = useHighlightedLines(
    lines,
    language,
    clickableSymbols,
    allowAnyIdentifier,
  );
  return (
    <div className="hunk__body hunk__body--context">
      {lines.map((line, i) => (
        <ContextLine
          key={`${prefix}-${i}`}
          filePath={path}
          language={language}
          line={line}
          highlightedHtml={highlightedLines?.[i]}
          onSymbolClick={onSymbolClick}
        />
      ))}
    </div>
  );
}

function HunkLinesBlock({
  path,
  hunkId,
  lines,
  language,
  cursorRef,
  clickableSymbols,
  allowAnyIdentifier,
  onSymbolClick,
  lineMouseHandlers,
}: {
  path: string;
  hunkId: string;
  lines: DiffLineViewModel[];
  language: string;
  cursorRef: React.RefObject<HTMLDivElement | null>;
  clickableSymbols?: ReadonlySet<string>;
  allowAnyIdentifier?: boolean;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
  lineMouseHandlers?: LineMouseHandlerProps;
}) {
  const highlightedLines = useHighlightedLines(
    lines,
    language,
    clickableSymbols,
    allowAnyIdentifier,
  );
  return (
    <div className="hunk__body" data-hunk-id={hunkId} {...(lineMouseHandlers ?? {})}>
      {lines.map((line, i) => (
        <Line
          key={i}
          filePath={path}
          language={language}
          line={line}
          lineIdx={i}
          highlightedHtml={highlightedLines?.[i]}
          cursorRef={line.isCursor ? cursorRef : undefined}
          onSymbolClick={onSymbolClick}
        />
      ))}
    </div>
  );
}

function LineText({
  filePath,
  language,
  text,
  sourceLine,
  highlightedHtml,
  onSymbolClick,
}: {
  filePath: string;
  language: string;
  text: string;
  sourceLine: number | null;
  highlightedHtml?: string;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
}) {
  if (!highlightedHtml) {
    return <span className="line__text">{text || " "}</span>;
  }

  const activateSymbol = (target: EventTarget | null) => {
    if (!onSymbolClick || !(target instanceof HTMLElement)) return;
    const token = target.closest<HTMLElement>("[data-symbol]");
    const symbol = token?.dataset.symbol;
    const rawCol = token?.dataset.tokenCol;
    const col = rawCol ? Number(rawCol) : Number.NaN;
    if (!symbol || sourceLine == null || !Number.isFinite(col)) return;
    onSymbolClick({
      symbol,
      file: filePath,
      language,
      line: sourceLine - 1,
      col,
    });
  };

  return (
    <span
      className="line__text line__text--highlighted"
      onClick={(event) => activateSymbol(event.target)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        activateSymbol(event.target);
      }}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}

function useHighlightedLines(
  lines: Array<{ text: string }>,
  language: string,
  clickableSymbols?: ReadonlySet<string>,
  allowAnyIdentifier?: boolean,
): string[] | null {
  const lineTexts = useMemo(() => lines.map((line) => line.text), [lines]);
  const symbolKey = useMemo(
    () => [...(clickableSymbols ?? [])].sort().join(","),
    [clickableSymbols],
  );
  const requestKey = `${language}::${symbolKey}::${allowAnyIdentifier ? "any" : "known"}\u0000${lineTexts.join("\n")}`;
  const [result, setResult] = useState<{ key: string; lines: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void highlightLines(lineTexts, language, undefined, {
      clickableSymbols,
      allowAnyIdentifier,
    }).then((next) => {
      if (!cancelled) {
        setResult({ key: requestKey, lines: next.lines });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [allowAnyIdentifier, clickableSymbols, language, lineTexts, requestKey]);

  return result?.key === requestKey ? result.lines : null;
}

function Badge({
  kind,
  title,
  children,
}: {
  kind: "ai" | "approve" | "comment" | "symbol" | "ref";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`badge badge--${kind}`} title={title}>
      {children}
    </span>
  );
}

type CharSelectionResult =
  | {
      kind: "single";
      hunkId: string;
      lineIdx: number;
      fromCol: number;
      toCol: number;
    }
  | {
      kind: "multi";
      hunkId: string;
      anchorLineIdx: number;
      headLineIdx: number;
    };

/**
 * Resolve a non-collapsed window.Selection into either a single-line
 * char-range or a multi-line line-range. Returns null when the selection
 * doesn't lie inside the diff body. UTF-16 column offsets are computed
 * relative to each line's `.line__text` ancestor — walking text nodes lets
 * the offsets survive the syntax-highlighter's nested span tree.
 */
function findScrollContainer(el: Element): HTMLElement | Window {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const cs = window.getComputedStyle(cur);
    if (
      (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
      cur.scrollHeight > cur.clientHeight
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return window;
}

function readNativeCharSelection(sel: Selection): CharSelectionResult | null {
  const anchorInfo = resolveSelectionEndpoint(sel.anchorNode, sel.anchorOffset);
  const focusInfo = resolveSelectionEndpoint(sel.focusNode, sel.focusOffset);
  if (!anchorInfo || !focusInfo) return null;
  if (anchorInfo.hunkId !== focusInfo.hunkId) return null;
  if (anchorInfo.lineIdx === focusInfo.lineIdx) {
    const fromCol = Math.min(anchorInfo.col, focusInfo.col);
    const toCol = Math.max(anchorInfo.col, focusInfo.col);
    if (fromCol >= toCol) return null;
    return {
      kind: "single",
      hunkId: anchorInfo.hunkId,
      lineIdx: anchorInfo.lineIdx,
      fromCol,
      toCol,
    };
  }
  return {
    kind: "multi",
    hunkId: anchorInfo.hunkId,
    anchorLineIdx: anchorInfo.lineIdx,
    headLineIdx: focusInfo.lineIdx,
  };
}

function resolveSelectionEndpoint(
  node: Node | null,
  offsetInNode: number,
): { hunkId: string; lineIdx: number; col: number } | null {
  if (!node) return null;
  const startEl = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!startEl) return null;
  const lineTextEl = startEl.closest<HTMLElement>(".line__text");
  const lineEl = lineTextEl?.closest<HTMLElement>("[data-line-idx]");
  const hunkEl = lineEl?.closest<HTMLElement>("[data-hunk-id]");
  if (!lineTextEl || !lineEl || !hunkEl) return null;
  const lineIdx = Number(lineEl.dataset.lineIdx);
  if (!Number.isFinite(lineIdx)) return null;
  const col = textOffsetWithin(lineTextEl, node, offsetInNode);
  if (col == null) return null;
  return { hunkId: hunkEl.dataset.hunkId!, lineIdx, col };
}

function textOffsetWithin(
  container: HTMLElement,
  node: Node,
  offsetInNode: number,
): number | null {
  if (node.nodeType === Node.ELEMENT_NODE) {
    // Selection endpoint lands on an element; offset counts child nodes.
    // Sum textContent length of preceding children.
    let sum = 0;
    const children = node.childNodes;
    for (let i = 0; i < offsetInNode && i < children.length; i++) {
      sum += children[i].textContent?.length ?? 0;
    }
    if (node === container) return sum;
    // Walk text nodes preceding `node` within container.
    return sumPrecedingTextLength(container, node) + sum;
  }
  if (node.nodeType !== Node.TEXT_NODE) return null;
  if (!container.contains(node)) return null;
  return sumPrecedingTextLength(container, node) + offsetInNode;
}

function sumPrecedingTextLength(container: HTMLElement, target: Node): number {
  let total = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === target) return total;
    total += (n.nodeValue ?? "").length;
  }
  return total;
}
