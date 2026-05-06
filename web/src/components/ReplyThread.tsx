import "./ReplyThread.css";
import { useEffect, useRef } from "react";
import type { Cursor, DeliveredComment, Reply } from "../types";
import type { SymbolIndex } from "../symbols";
import { RichText } from "./RichText";

interface Props {
  replies: Reply[];
  isDrafting: boolean;
  /**
   * Current draft body for this thread. Persists across composer
   * close/reopen — the parent owns it. The composer is fully
   * controlled.
   */
  draftBody: string;
  onStartDraft: () => void;
  /** Close the composer without discarding `draftBody`. */
  onCloseDraft: () => void;
  onChangeDraft: (body: string) => void;
  onSubmitReply: (body: string) => void;
  /** Delete a reply by id. Only invoked for user-authored replies. */
  onDeleteReply: (replyId: string) => void;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
  /**
   * Map keyed by `Comment.id` of comments the agent has fetched. Drives the
   * `✓ delivered` pip on each Reply whose `enqueuedCommentId` is in the map.
   * Empty/missing → no replies render the delivered glyph (only ◌ queued).
   */
  deliveredById?: Record<string, DeliveredComment>;
}

export function ReplyThread({
  replies,
  isDrafting,
  draftBody,
  onStartDraft,
  onCloseDraft,
  onChangeDraft,
  onSubmitReply,
  onDeleteReply,
  symbols,
  onJump,
  deliveredById,
}: Props) {
  // A non-empty draft on a closed composer means the user closed without
  // sending. Surface a hint so they know it's still waiting.
  const hasUnsentDraft = !isDrafting && draftBody.trim().length > 0;

  if (replies.length === 0 && !isDrafting) {
    return (
      <div className="thread thread--empty">
        <button className="thread__start" onClick={onStartDraft}>
          {hasUnsentDraft ? "↻ resume draft" : "+ reply"}
        </button>
      </div>
    );
  }
  return (
    <div className="thread">
      {replies.length > 0 && (
        <div className="thread__label">
          replies ({replies.length})
        </div>
      )}
      <ul className="thread__list">
        {replies.map((r) => (
          <li key={r.id} className="reply">
            <div className="reply__head">
              <span className="reply__author">@{r.author}</span>
              <span className="reply__sep">·</span>
              <span className="reply__time">{timeAgo(r.createdAt)}</span>
              <ReplyPip reply={r} deliveredById={deliveredById} />
              {r.author === "you" && (
                <button
                  className="reply__delete"
                  onClick={() => {
                    if (window.confirm("Delete this reply?")) {
                      onDeleteReply(r.id);
                    }
                  }}
                  title="delete reply"
                >
                  × delete
                </button>
              )}
            </div>
            <div className="reply__body">
              <RichText text={r.body} symbols={symbols} onJump={onJump} />
            </div>
          </li>
        ))}
      </ul>
      {isDrafting ? (
        <Composer
          body={draftBody}
          onChange={onChangeDraft}
          onClose={onCloseDraft}
          onSubmit={onSubmitReply}
        />
      ) : (
        <button className="thread__start" onClick={onStartDraft}>
          {hasUnsentDraft ? "↻ resume draft" : "+ reply"}
        </button>
      )}
    </div>
  );
}

function Composer({
  body,
  onChange,
  onClose,
  onSubmit,
}: {
  body: string;
  onChange: (body: string) => void;
  onClose: () => void;
  onSubmit: (body: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    // Place caret at the end when reopening a saved draft so the user
    // can keep typing without re-clicking.
    const len = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(len, len);
  }, []);
  return (
    <div className="composer">
      <textarea
        ref={ref}
        className="composer__input"
        value={body}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (body.trim()) onSubmit(body.trim());
          }
        }}
        placeholder="Write a reply…"
        rows={2}
      />
      <div className="composer__foot">
        <span className="composer__hint">
          <kbd>⌘Enter</kbd> send · <kbd>Esc</kbd> close (saves draft)
        </span>
        <button className="composer__cancel" onClick={onClose}>
          close
        </button>
        <button
          className="composer__send"
          disabled={!body.trim()}
          onClick={() => onSubmit(body.trim())}
        >
          send
        </button>
      </div>
    </div>
  );
}

/**
 * Per-reply queued/delivered pip. Three states:
 *   - no pip when `enqueuedCommentId` is null (reply hasn't been enqueued
 *     yet, or the enqueue POST failed — see § Pip semantics);
 *   - `◌ queued` when the id is set but no DeliveredComment with that id
 *     has been observed;
 *   - `✓ delivered` when the delivered map carries the id.
 *
 * Tooltips are exact strings from the share-review-comments plan. The queued
 * tooltip uses `Reply.createdAt` as the enqueue-time proxy: for fresh replies
 * the two are stamped within milliseconds of each other (the App dispatches
 * ADD_REPLY then fires `enqueueComment` in parallel) and we don't store the
 * enqueue moment locally yet.
 */
function ReplyPip({
  reply,
  deliveredById,
}: {
  reply: Reply;
  deliveredById?: Record<string, DeliveredComment>;
}) {
  const enqueuedId = reply.enqueuedCommentId ?? null;
  if (!enqueuedId) return null;
  const delivered = deliveredById?.[enqueuedId] ?? null;
  if (delivered) {
    return (
      <span
        className="reply__pip reply__pip--delivered"
        title={`Fetched by your agent at ${formatClock(delivered.deliveredAt)}.`}
      >
        ✓ delivered
      </span>
    );
  }
  return (
    <span
      className="reply__pip reply__pip--queued"
      title={`Sent to your agent's queue at ${formatClock(reply.createdAt)}.`}
    >
      ◌ queued
    </span>
  );
}

function formatClock(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "??:??:??";
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
