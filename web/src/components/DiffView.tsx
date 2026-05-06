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

interface Props {
  viewModel: DiffViewModel;
  onSetExpandLevel: (hunkId: string, dir: "above" | "below", level: number) => void;
  onToggleExpandFile: (fileId: string) => void;
  onTogglePreviewFile: (fileId: string) => void;
  clickableSymbols?: ReadonlySet<string>;
  allowAnyIdentifier?: boolean;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
}

export function DiffView({
  viewModel,
  onSetExpandLevel,
  onToggleExpandFile,
  onTogglePreviewFile,
  clickableSymbols,
  allowAnyIdentifier,
  onSymbolClick,
}: Props) {
  const cursorRef = useRef<HTMLDivElement>(null);

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

function HunkBlock({
  hunk,
  path,
  language,
  onSetExpandLevel,
  cursorRef,
  clickableSymbols,
  allowAnyIdentifier,
  onSymbolClick,
}: {
  hunk: HunkViewModel;
  path: string;
  language: string;
  onSetExpandLevel: (dir: "above" | "below", level: number) => void;
  cursorRef: React.RefObject<HTMLDivElement | null>;
  clickableSymbols?: ReadonlySet<string>;
  allowAnyIdentifier?: boolean;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
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
        lines={hunk.lines}
        language={language}
        cursorRef={cursorRef}
        clickableSymbols={clickableSymbols}
        allowAnyIdentifier={allowAnyIdentifier}
        onSymbolClick={onSymbolClick}
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
  highlightedHtml,
  cursorRef,
  onSymbolClick,
}: {
  filePath: string;
  language: string;
  line: DiffLineViewModel;
  highlightedHtml?: string;
  cursorRef?: React.RefObject<HTMLDivElement | null>;
  onSymbolClick?: (target: DefinitionClickTarget) => void;
}) {
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  const sev = line.aiNote?.severity;
  return (
    <div
      ref={cursorRef}
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
  lines,
  language,
  cursorRef,
  clickableSymbols,
  allowAnyIdentifier,
  onSymbolClick,
}: {
  path: string;
  lines: DiffLineViewModel[];
  language: string;
  cursorRef: React.RefObject<HTMLDivElement | null>;
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
    <div className="hunk__body">
      {lines.map((line, i) => (
        <Line
          key={i}
          filePath={path}
          language={language}
          line={line}
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
