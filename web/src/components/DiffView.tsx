import { useEffect, useRef } from "react";
import type { DiffFile, DiffLine, Hunk, Reply } from "../types";
import { noteKey, userCommentKey } from "../types";
import { hunkCoverage } from "../state";

interface Props {
  file: DiffFile;
  currentHunkId: string;
  cursorLineIdx: number;
  reviewed: Record<string, Set<number>>;
  acked: Set<string>;
  replies: Record<string, Reply[]>;
  expandLevelAbove: Record<string, number>;
  expandLevelBelow: Record<string, number>;
  fileFullyExpanded: boolean;
  onSetExpandLevel: (hunkId: string, dir: "above" | "below", level: number) => void;
  onToggleExpandFile: (fileId: string) => void;
}

export function DiffView({
  file,
  currentHunkId,
  cursorLineIdx,
  reviewed,
  acked,
  replies,
  expandLevelAbove,
  expandLevelBelow,
  fileFullyExpanded,
  onSetExpandLevel,
  onToggleExpandFile,
}: Props) {
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fileFullyExpanded) cursorRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentHunkId, cursorLineIdx, file.id, fileFullyExpanded]);

  return (
    <main className="diff">
      <header className="diff__path">
        <span className="diff__path-icon">▚</span> {file.path}
        <span className="diff__path-status">[{file.status}]</span>
        <span className="diff__spacer" />
        {file.fullContent && (
          <button
            className={`diff__expand-file ${fileFullyExpanded ? "diff__expand-file--on" : ""}`}
            onClick={() => onToggleExpandFile(file.id)}
            title="expand / collapse entire file"
          >
            {fileFullyExpanded ? "↙ collapse to hunks" : "↗ expand entire file"}
          </button>
        )}
      </header>

      {fileFullyExpanded && file.fullContent ? (
        <FullFileView file={file} />
      ) : (
        file.hunks.map((h) => (
          <HunkBlock
            key={h.id}
            hunk={h}
            isCurrent={h.id === currentHunkId}
            cursorLineIdx={h.id === currentHunkId ? cursorLineIdx : -1}
            reviewed={reviewed[h.id] ?? new Set()}
            acked={acked}
            replies={replies}
            coverage={hunkCoverage(h, reviewed)}
            levelAbove={expandLevelAbove[h.id] ?? 0}
            levelBelow={expandLevelBelow[h.id] ?? 0}
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
  isCurrent,
  cursorLineIdx,
  reviewed,
  acked,
  replies,
  coverage,
  levelAbove,
  levelBelow,
  onSetExpandLevel,
  cursorRef,
}: {
  hunk: Hunk;
  isCurrent: boolean;
  cursorLineIdx: number;
  reviewed: Set<number>;
  acked: Set<string>;
  replies: Record<string, Reply[]>;
  coverage: number;
  levelAbove: number;
  levelBelow: number;
  onSetExpandLevel: (dir: "above" | "below", level: number) => void;
  cursorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const aboveBlocks = hunk.expandAbove ?? [];
  const belowBlocks = hunk.expandBelow ?? [];

  // When rendering above the hunk, we need blocks in reverse index order:
  // the farthest-revealed block appears at the top, nearest immediately above
  // the hunk body. levelAbove is count of revealed blocks starting at index 0.
  const revealedAbove = aboveBlocks
    .slice(0, levelAbove)
    .map((b, i) => ({ block: b, idx: i }))
    .reverse();
  const revealedBelow = belowBlocks.slice(0, levelBelow);

  const nextAboveSize =
    levelAbove < aboveBlocks.length ? aboveBlocks[levelAbove].length : 0;
  const nextBelowSize =
    levelBelow < belowBlocks.length ? belowBlocks[levelBelow].length : 0;
  return (
    <section className={`hunk ${isCurrent ? "hunk--current" : ""}`}>
      <header className="hunk__h">
        <span className="hunk__meter">{Math.round(coverage * 100)}%</span>
        <span className="hunk__header-text">{hunk.header}</span>
        <span className="hunk__badges">
          {hunk.aiReviewed && <Badge kind="ai">AI ✓</Badge>}
          {hunk.teammateReview && (
            <Badge
              kind={hunk.teammateReview.verdict === "approve" ? "approve" : "comment"}
              title={hunk.teammateReview.note}
            >
              @{hunk.teammateReview.user} {hunk.teammateReview.verdict === "approve" ? "✓" : "💬"}
            </Badge>
          )}
          {hunk.definesSymbols?.map((s) => (
            <Badge key={s} kind="symbol">def {s}</Badge>
          ))}
          {hunk.referencesSymbols?.map((s) => (
            <Badge key={s} kind="ref">ref {s}</Badge>
          ))}
        </span>
      </header>

      {aboveBlocks.length > 0 && (
        <ExpandBar
          dir="above"
          level={levelAbove}
          maxLevel={aboveBlocks.length}
          nextSize={nextAboveSize}
          onExpand={() => onSetExpandLevel("above", levelAbove + 1)}
          onCollapse={() => onSetExpandLevel("above", 0)}
        />
      )}
      {revealedAbove.length > 0 && (
        <div className="hunk__body hunk__body--context">
          {revealedAbove.map(({ block, idx }) =>
            block.map((l, i) => (
              <ContextLine key={`ea-${idx}-${i}`} line={l} />
            )),
          )}
        </div>
      )}

      <div className="hunk__body">
        {hunk.lines.map((line, i) => (
          <Line
            key={i}
            line={line}
            isCursor={isCurrent && i === cursorLineIdx}
            isReviewed={reviewed.has(i)}
            isAcked={acked.has(noteKey(hunk.id, i))}
            hasUserComment={(replies[userCommentKey(hunk.id, i)]?.length ?? 0) > 0}
            cursorRef={isCurrent && i === cursorLineIdx ? cursorRef : undefined}
          />
        ))}
      </div>

      {revealedBelow.length > 0 && (
        <div className="hunk__body hunk__body--context">
          {revealedBelow.map((block, bi) =>
            block.map((l, i) => (
              <ContextLine key={`eb-${bi}-${i}`} line={l} />
            )),
          )}
        </div>
      )}
      {belowBlocks.length > 0 && (
        <ExpandBar
          dir="below"
          level={levelBelow}
          maxLevel={belowBlocks.length}
          nextSize={nextBelowSize}
          onExpand={() => onSetExpandLevel("below", levelBelow + 1)}
          onCollapse={() => onSetExpandLevel("below", 0)}
        />
      )}
    </section>
  );
}

function ExpandBar({
  dir,
  level,
  maxLevel,
  nextSize,
  onExpand,
  onCollapse,
}: {
  dir: "above" | "below";
  level: number;
  maxLevel: number;
  nextSize: number;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const arrow = dir === "above" ? "↑" : "↓";
  const hasMore = level < maxLevel;
  return (
    <div className="expandbar">
      {hasMore ? (
        <button className="expandbar__main" onClick={onExpand}>
          <span className="expandbar__arrow">{arrow}</span>{" "}
          expand {nextSize} line{nextSize === 1 ? "" : "s"} {dir} (to next block{" "}
          <span className="expandbar__lvl">
            {level + 1}/{maxLevel}
          </span>
          )
        </button>
      ) : (
        <span className="expandbar__main expandbar__main--done">
          <span className="expandbar__arrow">{arrow}</span> all {maxLevel} block
          {maxLevel === 1 ? "" : "s"} {dir} revealed
        </span>
      )}
      {level > 0 && (
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

function FullFileView({ file }: { file: DiffFile }) {
  return (
    <section className="hunk hunk--full">
      <header className="hunk__h">
        <span className="hunk__header-text">entire file · {file.path}</span>
      </header>
      <div className="hunk__body">
        {file.fullContent!.map((line, i) => (
          <div
            key={i}
            className={`line line--${line.kind} ${
              line.kind !== "context" ? "" : "line--ctx-expand"
            }`}
          >
            <span className="line__old">{line.oldNo ?? ""}</span>
            <span className="line__new">{line.newNo ?? ""}</span>
            <span className="line__ai" aria-hidden="true">{" "}</span>
            <span className="line__sign">
              {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
            </span>
            <span className="line__text">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Line({
  line,
  isCursor,
  isReviewed,
  isAcked,
  hasUserComment,
  cursorRef,
}: {
  line: DiffLine;
  isCursor: boolean;
  isReviewed: boolean;
  isAcked: boolean;
  hasUserComment: boolean;
  cursorRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  const sev = line.aiNote?.severity;
  const aiGlyph = isAcked
    ? "✓"
    : sev === "warning"
      ? "!"
      : sev === "question"
        ? "?"
        : sev
          ? "✦"
          : hasUserComment
            ? "“"
            : " ";
  return (
    <div
      ref={cursorRef}
      className={`line line--${line.kind} ${isCursor ? "line--cursor" : ""} ${
        isReviewed ? "line--reviewed" : ""
      } ${sev ? `line--ai-${sev}` : ""} ${isAcked ? "line--ai-acked" : ""} ${
        hasUserComment ? "line--has-comment" : ""
      }`}
      title={line.aiNote?.summary ?? (hasUserComment ? "user comment" : undefined)}
    >
      <span className="line__old">{line.oldNo ?? ""}</span>
      <span className="line__new">{line.newNo ?? ""}</span>
      <span className="line__ai" aria-hidden="true">
        {aiGlyph}
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
