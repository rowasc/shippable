import "./Inspector.css";
import type { Cursor, Reply } from "../types";
import type { SymbolIndex } from "../symbols";
import type {
  InspectorViewModel,
  AiNoteRowItem,
  UserCommentRowItem,
} from "../view";
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
  viewModel: InspectorViewModel;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
  onToggleAck: (hunkId: string, lineIdx: number) => void;
  onStartDraft: (key: string) => void;
  onCancelDraft: () => void;
  onSubmitReply: (key: string, body: string) => void;
}

export function Inspector({
  viewModel,
  symbols,
  onJump,
  onToggleAck,
  onStartDraft,
  onCancelDraft,
  onSubmitReply,
}: Props) {
  const vm = viewModel;

  return (
    <aside className="inspector">
      <header className="inspector__h">
        <span className="inspector__h-label">inspector</span>
        <span className="inspector__h-hint">
          <kbd>i</kbd> · <kbd>a</kbd> ack · <kbd>r</kbd> reply
        </span>
      </header>

      <section className="inspector__sec">
        <div className="inspector__loc">{vm.locationLabel}</div>
        <div className={`inspector__code inspector__code--${vm.lineKind}`}>
          <span className="inspector__code-sign">{vm.lineSign}</span>
          {vm.lineText || " "}
        </div>
      </section>

      <section className="inspector__sec">
        <div className="inspector__sec-h">
          AI concerns in this hunk
          <span className="inspector__sec-count">{vm.aiNoteCountLabel}</span>
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
                onJump={onJump}
                onAck={() => {
                  // Extract hunkId from the replyKey ("note:hunkId:lineIdx")
                  // by using the jumpTarget which carries hunkId directly.
                  onToggleAck(row.jumpTarget.hunkId, row.lineIdx);
                }}
                onClickLineNo={() => onJump(row.jumpTarget)}
                onStartDraft={() => onStartDraft(row.replyKey)}
                onCancelDraft={onCancelDraft}
                onSubmitReply={(body) => onSubmitReply(row.replyKey, body)}
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
          jumpTarget={vm.aiSummaryJumpTarget!}
          symbols={symbols}
          onJump={onJump}
          onStartDraft={() => onStartDraft(vm.aiSummaryReplyKey!)}
          onCancelDraft={onCancelDraft}
          onSubmitReply={(body) => onSubmitReply(vm.aiSummaryReplyKey!, body)}
        />
      )}

      {vm.teammate !== null && (
        <TeammateSection
          teammate={vm.teammate}
          symbols={symbols}
          onJump={onJump}
          onStartDraft={() => onStartDraft(vm.teammate!.replyKey)}
          onCancelDraft={onCancelDraft}
          onSubmitReply={(body) => onSubmitReply(vm.teammate!.replyKey, body)}
        />
      )}

      <UserCommentsSection
        vm={vm}
        symbols={symbols}
        onJump={onJump}
        onStartDraft={onStartDraft}
        onCancelDraft={onCancelDraft}
        onSubmitReply={onSubmitReply}
      />
    </aside>
  );
}

function UserCommentsSection({
  vm,
  symbols,
  onJump,
  onStartDraft,
  onCancelDraft,
  onSubmitReply,
}: {
  vm: InspectorViewModel;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
  onStartDraft: (key: string) => void;
  onCancelDraft: () => void;
  onSubmitReply: (key: string, body: string) => void;
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
          + comment on L{vm.currentLineNo}{" "}
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
              onJump={onJump}
              onClickLineNo={() => onJump(vm.draftStubRow!.jumpTarget)}
              onStartDraft={() => onStartDraft(vm.draftStubRow!.threadKey)}
              onCancelDraft={onCancelDraft}
              onSubmitReply={(body) =>
                onSubmitReply(vm.draftStubRow!.threadKey, body)
              }
            />
          )}
          {vm.userCommentRows.map((row) => (
            <UserThreadCard
              key={row.lineIdx}
              row={row}
              symbols={symbols}
              onJump={onJump}
              onClickLineNo={() => onJump(row.jumpTarget)}
              onStartDraft={() => onStartDraft(row.threadKey)}
              onCancelDraft={onCancelDraft}
              onSubmitReply={(body) => onSubmitReply(row.threadKey, body)}
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
  onJump,
  onClickLineNo,
  onStartDraft,
  onCancelDraft,
  onSubmitReply,
}: {
  row: UserCommentRowItem;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
  onClickLineNo: () => void;
  onStartDraft: () => void;
  onCancelDraft: () => void;
  onSubmitReply: (body: string) => void;
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
          title="jump to this line"
        >
          L{row.lineNo}
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
        onStartDraft={onStartDraft}
        onCancelDraft={onCancelDraft}
        onSubmitReply={onSubmitReply}
        symbols={symbols}
        onJump={onJump}
      />
    </li>
  );
}

function NoteCard({
  row,
  symbols,
  onJump,
  onAck,
  onClickLineNo,
  onStartDraft,
  onCancelDraft,
  onSubmitReply,
}: {
  row: AiNoteRowItem;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
  onAck: () => void;
  onClickLineNo: () => void;
  onStartDraft: () => void;
  onCancelDraft: () => void;
  onSubmitReply: (body: string) => void;
}) {
  return (
    <li
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
        <p className="ainote__detail">
          <RichText text={row.detail} symbols={symbols} onJump={onJump} />
        </p>
      )}
      <ReplyThread
        replies={row.replies}
        isDrafting={row.isDrafting}
        onStartDraft={onStartDraft}
        onCancelDraft={onCancelDraft}
        onSubmitReply={onSubmitReply}
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
  jumpTarget,
  symbols,
  onJump,
  onStartDraft,
  onCancelDraft,
  onSubmitReply,
}: {
  summary: string;
  replies: Reply[];
  replyKey: string;
  isDrafting: boolean;
  jumpTarget: Cursor;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
  onStartDraft: () => void;
  onCancelDraft: () => void;
  onSubmitReply: (body: string) => void;
}) {
  return (
    <section className="inspector__sec">
      <div className="inspector__sec-h">AI on this hunk (summary)</div>
      <div
        className="ainote ainote--info ainote--clickable"
        onClick={cardClick(() => onJump(jumpTarget))}
        title="click to jump to the top of this hunk"
      >
        <p className="inspector__summary">
          <RichText text={summary} symbols={symbols} onJump={onJump} />
        </p>
        <ReplyThread
          replies={replies}
          isDrafting={isDrafting}
          onStartDraft={onStartDraft}
          onCancelDraft={onCancelDraft}
          onSubmitReply={onSubmitReply}
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
  onJump,
  onStartDraft,
  onCancelDraft,
  onSubmitReply,
}: {
  teammate: NonNullable<InspectorViewModel["teammate"]>;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
  onStartDraft: () => void;
  onCancelDraft: () => void;
  onSubmitReply: (body: string) => void;
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
          <p className="ainote__detail">
            <RichText text={teammate.note} symbols={symbols} onJump={onJump} />
          </p>
        )}
        <ReplyThread
          replies={teammate.replies}
          isDrafting={teammate.isDrafting}
          onStartDraft={onStartDraft}
          onCancelDraft={onCancelDraft}
          onSubmitReply={onSubmitReply}
          symbols={symbols}
          onJump={onJump}
        />
      </div>
    </section>
  );
}
