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
}

export function DiffView({
  file,
  currentHunkId,
  cursorLineIdx,
  reviewed,
  acked,
  replies,
}: Props) {
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cursorRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentHunkId, cursorLineIdx, file.id]);

  return (
    <main className="diff">
      <header className="diff__path">
        <span className="diff__path-icon">▚</span> {file.path}
        <span className="diff__path-status">[{file.status}]</span>
      </header>
      {file.hunks.map((h) => (
        <HunkBlock
          key={h.id}
          hunk={h}
          isCurrent={h.id === currentHunkId}
          cursorLineIdx={h.id === currentHunkId ? cursorLineIdx : -1}
          reviewed={reviewed[h.id] ?? new Set()}
          acked={acked}
          replies={replies}
          coverage={hunkCoverage(h, reviewed)}
          cursorRef={cursorRef}
        />
      ))}
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
  cursorRef,
}: {
  hunk: Hunk;
  isCurrent: boolean;
  cursorLineIdx: number;
  reviewed: Set<number>;
  acked: Set<string>;
  replies: Record<string, Reply[]>;
  coverage: number;
  cursorRef: React.RefObject<HTMLDivElement | null>;
}) {
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
      <span className="line__text">{line.text || " "}</span>
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
