import "./ReplyThread.css";
import { useEffect, useRef } from "react";
import type { Cursor, Reply } from "../types";
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
   * Set of `sentToAgentId`s the server has already handed to a hook. Used
   * to flip the per-thread pip from `◌ queued` to `✓ delivered`. Empty
   * set is fine — every queued reply just stays in `◌ queued`.
   */
  deliveredIds?: Set<string>;
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
  deliveredIds,
}: Props) {
  // A non-empty draft on a closed composer means the user closed without
  // sending. Surface a hint so they know it's still waiting.
  const hasUnsentDraft = !isDrafting && draftBody.trim().length > 0;

  // Pip state derived from the union of replies and the latest delivered
  // set. Renders the freshest non-null pip — preferring `delivered` over
  // `queued` when at least one reply on the thread has crossed over.
  const pip = computePip(replies, deliveredIds);

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
          {pip && (
            <span
              className={`thread__pip thread__pip--${pip.kind}`}
              title={pip.title}
            >
              {pip.kind === "delivered" ? "✓ delivered" : "◌ queued"}
            </span>
          )}
        </div>
      )}
      <ul className="thread__list">
        {replies.map((r) => (
          <li key={r.id} className="reply">
            <div className="reply__head">
              <span className="reply__author">@{r.author}</span>
              <span className="reply__sep">·</span>
              <span className="reply__time">{timeAgo(r.createdAt)}</span>
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
 * Pick the freshest pip for a thread:
 *   - delivered: at least one reply's `sentToAgentId` is in `deliveredIds`.
 *   - queued: at least one reply has `sentToAgentAt` set but isn't yet in
 *     `deliveredIds`.
 *   - null: no replies have been pushed to the queue.
 *
 * Prefers `delivered` over `queued` so a thread with two replies — one
 * delivered, one still queued — surfaces the more useful "made it" signal.
 * Title carries the timestamps for the hover-affordance.
 */
function computePip(
  replies: Reply[],
  deliveredIds: Set<string> | undefined,
): { kind: "queued" | "delivered"; title: string } | null {
  let queuedAt: string | null = null;
  let delivered = false;
  for (const r of replies) {
    if (!r.sentToAgentAt) continue;
    if (queuedAt === null) queuedAt = r.sentToAgentAt;
    if (deliveredIds && r.sentToAgentId && deliveredIds.has(r.sentToAgentId)) {
      delivered = true;
    }
  }
  if (queuedAt === null) return null;
  const queuedTime = formatTime(queuedAt);
  if (delivered) {
    return {
      kind: "delivered",
      title: `Queued at ${queuedTime} — delivered`,
    };
  }
  return {
    kind: "queued",
    title: `Queued at ${queuedTime} — waiting on the agent's next tool call`,
  };
}

function formatTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const h = String(t.getHours()).padStart(2, "0");
  const m = String(t.getMinutes()).padStart(2, "0");
  const s = String(t.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
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
