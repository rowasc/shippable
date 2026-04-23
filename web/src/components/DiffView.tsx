import "./DiffView.css";
import { useEffect, useRef } from "react";
import type { DiffLine } from "../types";
import type {
  DiffViewModel,
  DiffLineViewModel,
  ExpandBarViewModel,
  FullFileLineViewModel,
  HunkViewModel,
} from "../view";

interface Props {
  viewModel: DiffViewModel;
  onSetExpandLevel: (hunkId: string, dir: "above" | "below", level: number) => void;
  onToggleExpandFile: (fileId: string) => void;
}

export function DiffView({ viewModel, onSetExpandLevel, onToggleExpandFile }: Props) {
  const cursorRef = useRef<HTMLDivElement>(null);

  // Derive the current hunk id and cursor line idx from the view model for the
  // scroll effect — we need to know when the cursor moves.
  const currentHunk = viewModel.hunks.find((h) => h.isCurrent);
  const cursorLineIdx = currentHunk?.lines.findIndex((l) => l.isCursor) ?? -1;

  useEffect(() => {
    if (!viewModel.fileFullyExpanded)
      cursorRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentHunk?.id, cursorLineIdx, viewModel.fileId, viewModel.fileFullyExpanded]);

  return (
    <main className="diff">
      <header className="diff__path">
        <span className="diff__path-icon">▚</span> {viewModel.path}
        <span className="diff__path-status">[{viewModel.status}]</span>
        <span className="diff__spacer" />
        {viewModel.canExpandFile && (
          <button
            className={`diff__expand-file ${viewModel.fileFullyExpanded ? "diff__expand-file--on" : ""}`}
            onClick={() => onToggleExpandFile(viewModel.fileId)}
            title="expand / collapse entire file"
          >
            {viewModel.fileFullyExpanded ? "↙ collapse to hunks" : "↗ expand entire file"}
          </button>
        )}
      </header>

      {viewModel.fileFullyExpanded ? (
        <FullFileView path={viewModel.path} lines={viewModel.fullFileLines} />
      ) : (
        viewModel.hunks.map((h) => (
          <HunkBlock
            key={h.id}
            hunk={h}
            onSetExpandLevel={(dir, level) => onSetExpandLevel(h.id, dir, level)}
            cursorRef={cursorRef}
          />
        ))
      )}
    </main>
  );
}

function HunkBlock({
  hunk,
  onSetExpandLevel,
  cursorRef,
}: {
  hunk: HunkViewModel;
  onSetExpandLevel: (dir: "above" | "below", level: number) => void;
  cursorRef: React.RefObject<HTMLDivElement | null>;
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
        <div className="hunk__body hunk__body--context">
          {hunk.contextAbove.map((l, i) => (
            <ContextLine key={`ea-${i}`} line={l} />
          ))}
        </div>
      )}

      <div className="hunk__body">
        {hunk.lines.map((line, i) => (
          <Line
            key={i}
            line={line}
            cursorRef={line.isCursor ? cursorRef : undefined}
          />
        ))}
      </div>

      {hunk.contextBelow.length > 0 && (
        <div className="hunk__body hunk__body--context">
          {hunk.contextBelow.map((l, i) => (
            <ContextLine key={`eb-${i}`} line={l} />
          ))}
        </div>
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
          <span className="expandbar__arrow">{arrow}</span> all {bar.maxLevel} block
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

function ContextLine({ line }: { line: DiffLine }) {
  return (
    <div className="line line--context line--ctx-expand">
      <span className="line__old">{line.oldNo ?? ""}</span>
      <span className="line__new">{line.newNo ?? ""}</span>
      <span className="line__ai" aria-hidden="true">{" "}</span>
      <span className="line__sign">{" "}</span>
      <span className="line__text">{line.text || " "}</span>
    </div>
  );
}

function FullFileView({
  path,
  lines,
}: {
  path: string;
  lines: FullFileLineViewModel[];
}) {
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
            <span className="line__text">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Line({
  line,
  cursorRef,
}: {
  line: DiffLineViewModel;
  cursorRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  const sev = line.aiNote?.severity;
  return (
    <div
      ref={cursorRef}
      className={`line line--${line.kind} ${line.isCursor ? "line--cursor" : ""} ${
        line.isReviewed ? "line--reviewed" : ""
      } ${line.isSelected ? "line--selected" : ""} ${sev ? `line--ai-${sev}` : ""} ${
        line.isAcked ? "line--ai-acked" : ""
      } ${line.hasUserComment ? "line--has-comment" : ""}`}
      title={line.aiNote?.summary ?? (line.hasUserComment ? "user comment" : undefined)}
    >
      <span className="line__old">{line.oldNo ?? ""}</span>
      <span className="line__new">{line.newNo ?? ""}</span>
      <span className="line__ai" aria-hidden="true">
        {line.aiGlyph}
      </span>
      <span className="line__sign">{sign}</span>
      <span className="line__text">{line.text || " "}</span>
    </div>
  );
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
