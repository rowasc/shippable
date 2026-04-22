import type { Cursor, DiffFile, Hunk, DiffLine, Reply } from "../types";
import {
  noteKey,
  lineNoteReplyKey,
  hunkSummaryReplyKey,
  teammateReplyKey,
  userCommentKey,
} from "../types";
import type { SymbolIndex } from "../symbols";
import { RichText } from "./RichText";
import { ReplyThread } from "./ReplyThread";
import type { MouseEvent } from "react";

/**
 * Wraps a jump action so a card's onClick ignores clicks that originated
 * inside an interactive child (buttons, textareas, the composer) or while
 * the user is actively selecting text.
 */
function cardClick(jump: () => void) {
  return (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, textarea, input, kbd, .composer")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) return;
    jump();
  };
}

interface Props {
  file: DiffFile;
  hunk: Hunk;
  line: DiffLine;
  cursor: Cursor;
  symbols: SymbolIndex;
  acked: Set<string>;
  replies: Record<string, Reply[]>;
  draftingKey: string | null;
  onJump: (c: Cursor) => void;
  onToggleAck: (hunkId: string, lineIdx: number) => void;
  onStartDraft: (key: string) => void;
  onCancelDraft: () => void;
  onSubmitReply: (key: string, body: string) => void;
}

export function Inspector({
  file,
  hunk,
  line,
  cursor,
  symbols,
  acked,
  replies,
  draftingKey,
  onJump,
  onToggleAck,
  onStartDraft,
  onCancelDraft,
  onSubmitReply,
}: Props) {
  const notes = hunk.lines
    .map((l, i) => ({ line: l, idx: i }))
    .filter(({ line }) => line.aiNote);

  return (
    <aside className="inspector">
      <header className="inspector__h">
        <span className="inspector__h-label">inspector</span>
        <span className="inspector__h-hint">
          <kbd>i</kbd> · <kbd>a</kbd> ack · <kbd>r</kbd> reply
        </span>
      </header>

      <section className="inspector__sec">
        <div className="inspector__loc">
          {file.path}
          {line.newNo ? `:${line.newNo}` : line.oldNo ? `:${line.oldNo}` : ""}
        </div>
        <div className={`inspector__code inspector__code--${line.kind}`}>
          <span className="inspector__code-sign">
            {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
          </span>
          {line.text || " "}
        </div>
      </section>

      <section className="inspector__sec">
        <div className="inspector__sec-h">
          AI concerns in this hunk
          <span className="inspector__sec-count">
            {notes.length === 0
              ? "none"
              : `${countAcked(notes, hunk.id, acked)}/${notes.length} acked`}
          </span>
        </div>
        {notes.length === 0 ? (
          <div className="inspector__empty">No AI notes on this hunk.</div>
        ) : (
          <ul className="notes">
            {notes.map(({ line: l, idx }) => {
              const rkey = lineNoteReplyKey(hunk.id, idx);
              return (
                <NoteCard
                  key={idx}
                  line={l}
                  lineIdx={idx}
                  isCurrent={idx === cursor.lineIdx}
                  isAcked={acked.has(noteKey(hunk.id, idx))}
                  replyKey={rkey}
                  replies={replies[rkey] ?? []}
                  isDrafting={draftingKey === rkey}
                  onClickLineNo={() =>
                    onJump({ ...cursor, hunkId: hunk.id, lineIdx: idx })
                  }
                  onAck={() => onToggleAck(hunk.id, idx)}
                  onStartDraft={() => onStartDraft(rkey)}
                  onCancelDraft={onCancelDraft}
                  onSubmitReply={(body) => onSubmitReply(rkey, body)}
                  symbols={symbols}
                  onJump={onJump}
                />
              );
            })}
          </ul>
        )}
      </section>

      {hunk.aiSummary && (
        <HunkSummarySection
          hunk={hunk}
          replies={replies[hunkSummaryReplyKey(hunk.id)] ?? []}
          replyKey={hunkSummaryReplyKey(hunk.id)}
          isDrafting={draftingKey === hunkSummaryReplyKey(hunk.id)}
          onStartDraft={() => onStartDraft(hunkSummaryReplyKey(hunk.id))}
          onCancelDraft={onCancelDraft}
          onSubmitReply={(body) =>
            onSubmitReply(hunkSummaryReplyKey(hunk.id), body)
          }
          onJumpToHunk={() =>
            onJump({ ...cursor, hunkId: hunk.id, lineIdx: 0 })
          }
          symbols={symbols}
          onJump={onJump}
        />
      )}

      {hunk.teammateReview && (
        <TeammateSection
          hunk={hunk}
          replies={replies[teammateReplyKey(hunk.id)] ?? []}
          replyKey={teammateReplyKey(hunk.id)}
          isDrafting={draftingKey === teammateReplyKey(hunk.id)}
          onStartDraft={() => onStartDraft(teammateReplyKey(hunk.id))}
          onCancelDraft={onCancelDraft}
          onSubmitReply={(body) =>
            onSubmitReply(teammateReplyKey(hunk.id), body)
          }
          onJumpToHunk={() =>
            onJump({ ...cursor, hunkId: hunk.id, lineIdx: 0 })
          }
          symbols={symbols}
          onJump={onJump}
        />
      )}

      <UserCommentsSection
        hunk={hunk}
        cursor={cursor}
        replies={replies}
        draftingKey={draftingKey}
        onJump={onJump}
        onStartDraft={onStartDraft}
        onCancelDraft={onCancelDraft}
        onSubmitReply={onSubmitReply}
        symbols={symbols}
      />
    </aside>
  );
}

function UserCommentsSection({
  hunk,
  cursor,
  replies,
  draftingKey,
  onJump,
  onStartDraft,
  onCancelDraft,
  onSubmitReply,
  symbols,
}: {
  hunk: Hunk;
  cursor: Cursor;
  replies: Record<string, Reply[]>;
  draftingKey: string | null;
  onJump: (c: Cursor) => void;
  onStartDraft: (key: string) => void;
  onCancelDraft: () => void;
  onSubmitReply: (key: string, body: string) => void;
  symbols: SymbolIndex;
}) {
  const threads = hunk.lines
    .map((l, i) => ({ line: l, idx: i, key: userCommentKey(hunk.id, i) }))
    .filter(
      ({ key }) => (replies[key]?.length ?? 0) > 0 || draftingKey === key,
    );

  const curKey = userCommentKey(hunk.id, cursor.lineIdx);
  const curLine = hunk.lines[cursor.lineIdx];
  const curLineNo = curLine?.newNo ?? curLine?.oldNo ?? cursor.lineIdx + 1;
  const curHasThread = threads.some((t) => t.key === curKey);

  return (
    <section className="inspector__sec">
      <div className="inspector__sec-h">
        Your comments
        <span className="inspector__sec-count">
          {threads.length === 0 ? "none" : `${threads.length} thread${threads.length > 1 ? "s" : ""}`}
        </span>
      </div>

      {!curHasThread && draftingKey !== curKey && (
        <button
          className="thread__start thread__start--cta"
          onClick={() => onStartDraft(curKey)}
        >
          + comment on L{curLineNo} <span className="thread__start-hint">press <kbd>c</kbd></span>
        </button>
      )}

      {threads.length === 0 && draftingKey !== curKey ? (
        <div className="inspector__empty">No user comments on this hunk yet.</div>
      ) : (
        <ul className="notes">
          {/* if drafting on current line and no thread exists yet, show a stub card */}
          {!curHasThread && draftingKey === curKey && (
            <UserThreadCard
              lineIdx={cursor.lineIdx}
              line={curLine}
              threadKey={curKey}
              replies={[]}
              isDrafting
              isCurrent
              onClickLineNo={() =>
                onJump({ ...cursor, hunkId: hunk.id, lineIdx: cursor.lineIdx })
              }
              onStartDraft={() => onStartDraft(curKey)}
              onCancelDraft={onCancelDraft}
              onSubmitReply={(body) => onSubmitReply(curKey, body)}
              symbols={symbols}
              onJump={onJump}
            />
          )}
          {threads.map(({ line: l, idx, key }) => (
            <UserThreadCard
              key={idx}
              lineIdx={idx}
              line={l}
              threadKey={key}
              replies={replies[key] ?? []}
              isDrafting={draftingKey === key}
              isCurrent={idx === cursor.lineIdx}
              onClickLineNo={() =>
                onJump({ ...cursor, hunkId: hunk.id, lineIdx: idx })
              }
              onStartDraft={() => onStartDraft(key)}
              onCancelDraft={onCancelDraft}
              onSubmitReply={(body) => onSubmitReply(key, body)}
              symbols={symbols}
              onJump={onJump}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function UserThreadCard({
  lineIdx,
  line,
  replies,
  isDrafting,
  isCurrent,
  onClickLineNo,
  onStartDraft,
  onCancelDraft,
  onSubmitReply,
  symbols,
  onJump,
}: {
  lineIdx: number;
  line: DiffLine;
  threadKey: string;
  replies: Reply[];
  isDrafting: boolean;
  isCurrent: boolean;
  onClickLineNo: () => void;
  onStartDraft: () => void;
  onCancelDraft: () => void;
  onSubmitReply: (body: string) => void;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
}) {
  const lineNo = line?.newNo ?? line?.oldNo ?? lineIdx + 1;
  return (
    <li
      className={`ainote ainote--user ainote--clickable ${
        isCurrent ? "ainote--current" : ""
      }`}
      onClick={cardClick(onClickLineNo)}
      title="click to jump to this line"
    >
      <div className="ainote__head">
        <button
          className="ainote__lineno"
          onClick={onClickLineNo}
          title="jump to this line"
        >
          L{lineNo}
        </button>
        <span className="ainote__summary ainote__summary--muted">
          {replies.length === 0
            ? "new thread"
            : `${replies.length} message${replies.length > 1 ? "s" : ""}`}
        </span>
      </div>
      <ReplyThread
        replies={replies}
        isDrafting={isDrafting}
        onStartDraft={onStartDraft}
        onCancelDraft={onCancelDraft}
        onSubmitReply={onSubmitReply}
        symbols={symbols}
        onJump={onJump}
      />
    </li>
  );
}

interface CardCommon {
  replies: Reply[];
  replyKey: string;
  isDrafting: boolean;
  onStartDraft: () => void;
  onCancelDraft: () => void;
  onSubmitReply: (body: string) => void;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
}

function NoteCard({
  line,
  lineIdx,
  isCurrent,
  isAcked,
  onClickLineNo,
  onAck,
  ...rest
}: CardCommon & {
  line: DiffLine;
  lineIdx: number;
  isCurrent: boolean;
  isAcked: boolean;
  onClickLineNo: () => void;
  onAck: () => void;
}) {
  const note = line.aiNote!;
  const lineNo = line.newNo ?? line.oldNo ?? lineIdx + 1;
  return (
    <li
      className={`ainote ainote--${note.severity} ainote--clickable ${
        isCurrent ? "ainote--current" : ""
      } ${isAcked ? "ainote--acked" : ""}`}
      onClick={cardClick(onClickLineNo)}
      title="click to jump to this line"
    >
      <div className="ainote__head">
        <button
          className="ainote__lineno"
          onClick={onClickLineNo}
          title="jump to this line"
        >
          L{lineNo}
        </button>
        <span className="ainote__sev">{sevGlyph(note.severity)}</span>
        <span className="ainote__summary">
          <RichText text={note.summary} symbols={rest.symbols} onJump={rest.onJump} />
        </span>
        <span className="ainote__actions">
          <button
            className="ainote__ack"
            onClick={rest.onStartDraft}
            title="reply"
          >
            reply
          </button>
          <button
            className={`ainote__ack ${isAcked ? "ainote__ack--on" : ""}`}
            onClick={onAck}
            title={isAcked ? "un-ack" : "acknowledge"}
          >
            {isAcked ? "✓ acked" : "ack"}
          </button>
        </span>
      </div>
      {note.detail && (
        <p className="ainote__detail">
          <RichText text={note.detail} symbols={rest.symbols} onJump={rest.onJump} />
        </p>
      )}
      <ReplyThread
        replies={rest.replies}
        isDrafting={rest.isDrafting}
        onStartDraft={rest.onStartDraft}
        onCancelDraft={rest.onCancelDraft}
        onSubmitReply={rest.onSubmitReply}
        symbols={rest.symbols}
        onJump={rest.onJump}
      />
    </li>
  );
}

function HunkSummarySection({
  hunk,
  onJumpToHunk,
  ...rest
}: CardCommon & { hunk: Hunk; onJumpToHunk: () => void }) {
  return (
    <section className="inspector__sec">
      <div className="inspector__sec-h">AI on this hunk (summary)</div>
      <div
        className="ainote ainote--info ainote--clickable"
        onClick={cardClick(onJumpToHunk)}
        title="click to jump to the top of this hunk"
      >
        <p className="inspector__summary">
          <RichText
            text={hunk.aiSummary!}
            symbols={rest.symbols}
            onJump={rest.onJump}
          />
        </p>
        <ReplyThread
          replies={rest.replies}
          isDrafting={rest.isDrafting}
          onStartDraft={rest.onStartDraft}
          onCancelDraft={rest.onCancelDraft}
          onSubmitReply={rest.onSubmitReply}
          symbols={rest.symbols}
          onJump={rest.onJump}
        />
      </div>
    </section>
  );
}

function TeammateSection({
  hunk,
  onJumpToHunk,
  ...rest
}: CardCommon & { hunk: Hunk; onJumpToHunk: () => void }) {
  const t = hunk.teammateReview!;
  return (
    <section className="inspector__sec">
      <div className="inspector__sec-h">Teammate</div>
      <div
        className={`ainote ainote--clickable ainote--${t.verdict === "approve" ? "info" : "question"}`}
        onClick={cardClick(onJumpToHunk)}
        title="click to jump to the top of this hunk"
      >
        <div className="ainote__head">
          <span className="ainote__sev">
            @{t.user} {t.verdict === "approve" ? "✓" : "💬"}
          </span>
        </div>
        {t.note && (
          <p className="ainote__detail">
            <RichText text={t.note} symbols={rest.symbols} onJump={rest.onJump} />
          </p>
        )}
        <ReplyThread
          replies={rest.replies}
          isDrafting={rest.isDrafting}
          onStartDraft={rest.onStartDraft}
          onCancelDraft={rest.onCancelDraft}
          onSubmitReply={rest.onSubmitReply}
          symbols={rest.symbols}
          onJump={rest.onJump}
        />
      </div>
    </section>
  );
}

function countAcked(
  notes: { idx: number }[],
  hunkId: string,
  acked: Set<string>,
): number {
  let n = 0;
  for (const { idx } of notes) {
    if (acked.has(noteKey(hunkId, idx))) n++;
  }
  return n;
}

function sevGlyph(s: "info" | "question" | "warning"): string {
  switch (s) {
    case "warning":
      return "!";
    case "question":
      return "?";
    case "info":
    default:
      return "i";
  }
}
