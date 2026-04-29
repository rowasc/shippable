import "./Inspector.css";
import type { Cursor, LineSelection, Reply } from "../types";
import type { SymbolIndex } from "../symbols";
import { CodeText } from "./CodeText";
import type {
  InspectorViewModel,
  AiNoteRowItem,
  UserCommentRowItem,
} from "../view";
import { RichText } from "./RichText";
import { ReplyThread } from "./ReplyThread";
import { useEffect, useRef } from "react";
import type { MouseEvent, RefObject } from "react";

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
  viewModel: InspectorViewModel;
  symbols: SymbolIndex;
  /**
   * Per-key draft bodies. The composer is fully controlled by this map —
   * closing the composer (Esc / close button) does not clear the entry,
   * so reopening restores what the user typed.
   */
  draftBodies: Record<string, string>;
  onJump: (c: Cursor) => void;
  /**
   * Clicking a block-scoped comment should re-select its range so the user
   * sees what they're replying to. Plain line threads use onJump and leave
   * selection collapsed.
   */
  onJumpToBlock?: (cursor: Cursor, selection: LineSelection) => void;
  onToggleAck: (hunkId: string, lineIdx: number) => void;
  onStartDraft: (key: string) => void;
  /** Close the composer without discarding the draft. */
  onCloseDraft: () => void;
  onChangeDraft: (key: string, body: string) => void;
  onSubmitReply: (key: string, body: string) => void;
  /** Delete a reply by id within the given thread. UI gates this to
   *  user-authored entries; the reducer enforces no other contracts. */
  onDeleteReply: (key: string, replyId: string) => void;
}

export function Inspector({
  viewModel,
  symbols,
  draftBodies,
  onJump,
  onJumpToBlock,
  onToggleAck,
  onStartDraft,
  onCloseDraft,
  onChangeDraft,
  onSubmitReply,
  onDeleteReply,
}: Props) {
  const vm = viewModel;
  const draftFor = (key: string) => draftBodies[key] ?? "";

  // Keep the AI note for the current line on screen as the cursor moves.
  // Mirrors what DiffView already does for the cursor itself — without
  // this, the "current" highlight in the inspector can drift off the top
  // when the hunk has many notes.
  const currentNoteRef = useRef<HTMLLIElement | null>(null);
  const currentNoteLineIdx =
    vm.aiNoteRows.find((r) => r.isCurrent)?.lineIdx ?? null;
  useEffect(() => {
    if (currentNoteLineIdx === null) return;
    currentNoteRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentNoteLineIdx]);

  // The location card duplicates the line text that the matching AI
  // note already shows when the cursor is on a noted line — collapse to
  // the path-only label in that case so the inspector doesn't repeat
  // itself. When there's no matching note, the code preview earns its
  // space back as the only "what am I looking at" cue.
  const cursorOnNote = currentNoteLineIdx !== null;

  return (
    <aside className="inspector">
      <header className="inspector__h">
        <span className="inspector__h-label">inspector</span>
        <span className="inspector__h-viewer">viewing as @you</span>
        <span className="inspector__h-hint">
          <kbd>i</kbd> · <kbd>a</kbd> ack · <kbd>r</kbd> reply
        </span>
      </header>

      <section className="inspector__sec">
        <div className="inspector__loc">{vm.locationLabel}</div>
        {!cursorOnNote && (
          <div className={`inspector__code inspector__code--${vm.lineKind}`}>
            <span className="inspector__code-sign">{vm.lineSign}</span>
            {vm.lineText ? <CodeText text={vm.lineText} language={vm.language} /> : " "}
          </div>
        )}
      </section>

      <section className="inspector__sec">
        <div className="inspector__sec-h">
          AI concerns in this hunk
          <span className="inspector__sec-count">{vm.aiNoteCountLabel}</span>
          {vm.nextNoteHint && (
            <button
              className="inspector__sec-jump"
              onClick={() => onJump(vm.nextNoteHint!.jumpTarget)}
              title="jump to the nearest AI note"
            >
              {vm.nextNoteHint.label}
            </button>
          )}
        </div>
        {!vm.hasAiNotes ? (
          <div className="inspector__empty">No AI notes on this hunk.</div>
        ) : (
          <ul className="notes">
            {vm.aiNoteRows.map((row) => (
              <NoteCard
                key={row.lineIdx}
                row={row}
                symbols={symbols}
                draftBody={draftFor(row.replyKey)}
                cardRef={row.isCurrent ? currentNoteRef : undefined}
                onJump={onJump}
                onAck={() => {
                  // Extract hunkId from the replyKey ("note:hunkId:lineIdx")
                  // by using the jumpTarget which carries hunkId directly.
                  onToggleAck(row.jumpTarget.hunkId, row.lineIdx);
                }}
                onClickLineNo={() => onJump(row.jumpTarget)}
                onStartDraft={() => onStartDraft(row.replyKey)}
                onCloseDraft={onCloseDraft}
                onChangeDraft={(body) => onChangeDraft(row.replyKey, body)}
                onSubmitReply={(body) => onSubmitReply(row.replyKey, body)}
                onDeleteReply={(replyId) =>
                  onDeleteReply(row.replyKey, replyId)
                }
              />
            ))}
          </ul>
        )}
      </section>

      {vm.aiSummary !== null && vm.aiSummaryReplyKey !== null && (
        <HunkSummarySection
          summary={vm.aiSummary}
          replies={vm.aiSummaryReplies}
          replyKey={vm.aiSummaryReplyKey}
          isDrafting={vm.aiSummaryIsDrafting}
          draftBody={draftFor(vm.aiSummaryReplyKey)}
          jumpTarget={vm.aiSummaryJumpTarget!}
          symbols={symbols}
          onJump={onJump}
          onStartDraft={() => onStartDraft(vm.aiSummaryReplyKey!)}
          onCloseDraft={onCloseDraft}
          onChangeDraft={(body) => onChangeDraft(vm.aiSummaryReplyKey!, body)}
          onSubmitReply={(body) => onSubmitReply(vm.aiSummaryReplyKey!, body)}
          onDeleteReply={(replyId) =>
            onDeleteReply(vm.aiSummaryReplyKey!, replyId)
          }
        />
      )}

      {vm.teammate !== null && (
        <TeammateSection
          teammate={vm.teammate}
          symbols={symbols}
          draftBody={draftFor(vm.teammate.replyKey)}
          onJump={onJump}
          onStartDraft={() => onStartDraft(vm.teammate!.replyKey)}
          onCloseDraft={onCloseDraft}
          onChangeDraft={(body) => onChangeDraft(vm.teammate!.replyKey, body)}
          onSubmitReply={(body) => onSubmitReply(vm.teammate!.replyKey, body)}
          onDeleteReply={(replyId) =>
            onDeleteReply(vm.teammate!.replyKey, replyId)
          }
        />
      )}

      <UserCommentsSection
        vm={vm}
        symbols={symbols}
        draftFor={draftFor}
        onJump={onJump}
        onJumpToBlock={onJumpToBlock}
        onStartDraft={onStartDraft}
        onCloseDraft={onCloseDraft}
        onChangeDraft={onChangeDraft}
        onSubmitReply={onSubmitReply}
        onDeleteReply={onDeleteReply}
      />
    </aside>
  );
}

function UserCommentsSection({
  vm,
  symbols,
  draftFor,
  onJump,
  onJumpToBlock,
  onStartDraft,
  onCloseDraft,
  onChangeDraft,
  onSubmitReply,
  onDeleteReply,
}: {
  vm: InspectorViewModel;
  symbols: SymbolIndex;
  draftFor: (key: string) => string;
  onJump: (c: Cursor) => void;
  onJumpToBlock?: (cursor: Cursor, selection: LineSelection) => void;
  onStartDraft: (key: string) => void;
  onCloseDraft: () => void;
  onChangeDraft: (key: string, body: string) => void;
  onSubmitReply: (key: string, body: string) => void;
  onDeleteReply: (key: string, replyId: string) => void;
}) {
  return (
    <section className="inspector__sec">
      <div className="inspector__sec-h">
        Your comments
        <span className="inspector__sec-count">{vm.userCommentCountLabel}</span>
      </div>

      {vm.showNewCommentCta && (
        <button
          className="thread__start thread__start--cta"
          onClick={() => onStartDraft(vm.currentLineCommentKey)}
        >
          {draftFor(vm.currentLineCommentKey).trim()
            ? "↻ resume draft"
            : `+ comment on L${vm.currentLineNo}`}{" "}
          <span className="thread__start-hint">
            press <kbd>c</kbd>
          </span>
        </button>
      )}

      {vm.userCommentRows.length === 0 && !vm.showDraftStub ? (
        <div className="inspector__empty">No user comments on this hunk yet.</div>
      ) : (
        <ul className="notes">
          {vm.draftStubRow && (
            <UserThreadCard
              row={vm.draftStubRow}
              symbols={symbols}
              draftBody={draftFor(vm.draftStubRow.threadKey)}
              onJump={onJump}
              onClickLineNo={() => onJump(vm.draftStubRow!.jumpTarget)}
              onStartDraft={() => onStartDraft(vm.draftStubRow!.threadKey)}
              onCloseDraft={onCloseDraft}
              onChangeDraft={(body) =>
                onChangeDraft(vm.draftStubRow!.threadKey, body)
              }
              onSubmitReply={(body) =>
                onSubmitReply(vm.draftStubRow!.threadKey, body)
              }
              onDeleteReply={(replyId) =>
                onDeleteReply(vm.draftStubRow!.threadKey, replyId)
              }
            />
          )}
          {vm.userCommentRows.map((row) => (
            <UserThreadCard
              key={row.threadKey}
              row={row}
              symbols={symbols}
              draftBody={draftFor(row.threadKey)}
              onJump={onJump}
              onClickLineNo={() => {
                if (row.rangeHiLineIdx !== undefined && onJumpToBlock) {
                  onJumpToBlock(row.jumpTarget, {
                    hunkId: row.jumpTarget.hunkId,
                    anchor: row.lineIdx,
                    head: row.rangeHiLineIdx,
                  });
                } else {
                  onJump(row.jumpTarget);
                }
              }}
              onStartDraft={() => onStartDraft(row.threadKey)}
              onCloseDraft={onCloseDraft}
              onChangeDraft={(body) => onChangeDraft(row.threadKey, body)}
              onSubmitReply={(body) => onSubmitReply(row.threadKey, body)}
              onDeleteReply={(replyId) =>
                onDeleteReply(row.threadKey, replyId)
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function UserThreadCard({
  row,
  symbols,
  draftBody,
  onJump,
  onClickLineNo,
  onStartDraft,
  onCloseDraft,
  onChangeDraft,
  onSubmitReply,
  onDeleteReply,
}: {
  row: UserCommentRowItem;
  symbols: SymbolIndex;
  draftBody: string;
  onJump: (c: Cursor) => void;
  onClickLineNo: () => void;
  onStartDraft: () => void;
  onCloseDraft: () => void;
  onChangeDraft: (body: string) => void;
  onSubmitReply: (body: string) => void;
  onDeleteReply: (replyId: string) => void;
}) {
  return (
    <li
      className={`ainote ainote--user ainote--clickable ${
        row.isCurrent ? "ainote--current" : ""
      }`}
      onClick={cardClick(onClickLineNo)}
      title="click to jump to this line"
    >
      <div className="ainote__head">
        <button
          className="ainote__lineno"
          onClick={onClickLineNo}
          title={
            row.rangeHiLineNo
              ? `jump to lines L${row.lineNo}–L${row.rangeHiLineNo}`
              : "jump to this line"
          }
        >
          {row.rangeHiLineNo
            ? `L${row.lineNo}–L${row.rangeHiLineNo}`
            : `L${row.lineNo}`}
        </button>
        <span className="ainote__summary ainote__summary--muted">
          {row.replies.length === 0
            ? "new thread"
            : `${row.replies.length} message${row.replies.length > 1 ? "s" : ""}`}
        </span>
      </div>
      <ReplyThread
        replies={row.replies}
        isDrafting={row.isDrafting}
        draftBody={draftBody}
        onStartDraft={onStartDraft}
        onCloseDraft={onCloseDraft}
        onChangeDraft={onChangeDraft}
        onSubmitReply={onSubmitReply}
        onDeleteReply={onDeleteReply}
        symbols={symbols}
        onJump={onJump}
      />
    </li>
  );
}

function NoteCard({
  row,
  symbols,
  draftBody,
  cardRef,
  onJump,
  onAck,
  onClickLineNo,
  onStartDraft,
  onCloseDraft,
  onChangeDraft,
  onSubmitReply,
  onDeleteReply,
}: {
  row: AiNoteRowItem;
  symbols: SymbolIndex;
  draftBody: string;
  /** Attached only when this is the cursor's note — drives auto-scroll. */
  cardRef?: RefObject<HTMLLIElement | null>;
  onJump: (c: Cursor) => void;
  onAck: () => void;
  onClickLineNo: () => void;
  onStartDraft: () => void;
  onCloseDraft: () => void;
  onChangeDraft: (body: string) => void;
  onSubmitReply: (body: string) => void;
  onDeleteReply: (replyId: string) => void;
}) {
  return (
    <li
      ref={cardRef}
      className={`ainote ainote--${row.severity} ainote--clickable ${
        row.isCurrent ? "ainote--current" : ""
      } ${row.isAcked ? "ainote--acked" : ""}`}
      onClick={cardClick(onClickLineNo)}
      title="click to jump to this line"
    >
      <div className="ainote__head">
        <button
          className="ainote__lineno"
          onClick={onClickLineNo}
          title="jump to this line"
        >
          L{row.lineNo}
        </button>
        <span className="ainote__sev">{row.sevGlyph}</span>
        <span className="ainote__summary">
          <RichText text={row.summary} symbols={symbols} onJump={onJump} />
        </span>
        <span className="ainote__actions">
          <button className="ainote__ack" onClick={onStartDraft} title="reply">
            reply
          </button>
          <button
            className={`ainote__ack ${row.isAcked ? "ainote__ack--on" : ""}`}
            onClick={onAck}
            title={row.isAcked ? "un-ack" : "acknowledge"}
          >
            {row.isAcked ? "✓ acked" : "ack"}
          </button>
        </span>
      </div>
      {row.detail && (
        <div className="ainote__detail">
          <RichText text={row.detail} symbols={symbols} onJump={onJump} />
        </div>
      )}
      <ReplyThread
        replies={row.replies}
        isDrafting={row.isDrafting}
        draftBody={draftBody}
        onStartDraft={onStartDraft}
        onCloseDraft={onCloseDraft}
        onChangeDraft={onChangeDraft}
        onSubmitReply={onSubmitReply}
        onDeleteReply={onDeleteReply}
        symbols={symbols}
        onJump={onJump}
      />
    </li>
  );
}

function HunkSummarySection({
  summary,
  replies,
  isDrafting,
  draftBody,
  jumpTarget,
  symbols,
  onJump,
  onStartDraft,
  onCloseDraft,
  onChangeDraft,
  onSubmitReply,
  onDeleteReply,
}: {
  summary: string;
  replies: Reply[];
  replyKey: string;
  isDrafting: boolean;
  draftBody: string;
  jumpTarget: Cursor;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
  onStartDraft: () => void;
  onCloseDraft: () => void;
  onChangeDraft: (body: string) => void;
  onSubmitReply: (body: string) => void;
  onDeleteReply: (replyId: string) => void;
}) {
  return (
    <section className="inspector__sec">
      <div className="inspector__sec-h">AI on this hunk (summary)</div>
      <div
        className="ainote ainote--info ainote--clickable"
        onClick={cardClick(() => onJump(jumpTarget))}
        title="click to jump to the top of this hunk"
      >
        <div className="inspector__summary">
          <RichText text={summary} symbols={symbols} onJump={onJump} />
        </div>
        <ReplyThread
          replies={replies}
          isDrafting={isDrafting}
          draftBody={draftBody}
          onStartDraft={onStartDraft}
          onCloseDraft={onCloseDraft}
          onChangeDraft={onChangeDraft}
          onSubmitReply={onSubmitReply}
          onDeleteReply={onDeleteReply}
          symbols={symbols}
          onJump={onJump}
        />
      </div>
    </section>
  );
}

function TeammateSection({
  teammate,
  symbols,
  draftBody,
  onJump,
  onStartDraft,
  onCloseDraft,
  onChangeDraft,
  onSubmitReply,
  onDeleteReply,
}: {
  teammate: NonNullable<InspectorViewModel["teammate"]>;
  symbols: SymbolIndex;
  draftBody: string;
  onJump: (c: Cursor) => void;
  onStartDraft: () => void;
  onCloseDraft: () => void;
  onChangeDraft: (body: string) => void;
  onSubmitReply: (body: string) => void;
  onDeleteReply: (replyId: string) => void;
}) {
  return (
    <section className="inspector__sec">
      <div className="inspector__sec-h">Teammate</div>
      <div
        className={`ainote ainote--clickable ainote--${teammate.verdictClass}`}
        onClick={cardClick(() => onJump(teammate.jumpTarget))}
        title="click to jump to the top of this hunk"
      >
        <div className="ainote__head">
          <span className="ainote__sev">
            @{teammate.user} {teammate.verdictGlyph}
          </span>
        </div>
        {teammate.note && (
          <div className="ainote__detail">
            <RichText text={teammate.note} symbols={symbols} onJump={onJump} />
          </div>
        )}
        <ReplyThread
          replies={teammate.replies}
          isDrafting={teammate.isDrafting}
          draftBody={draftBody}
          onStartDraft={onStartDraft}
          onCloseDraft={onCloseDraft}
          onChangeDraft={onChangeDraft}
          onSubmitReply={onSubmitReply}
          onDeleteReply={onDeleteReply}
          symbols={symbols}
          onJump={onJump}
        />
      </div>
    </section>
  );
}
