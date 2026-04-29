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
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
}

export function ReplyThread({
  replies,
  isDrafting,
  draftBody,
  onStartDraft,
  onCloseDraft,
  onChangeDraft,
  onSubmitReply,
  symbols,
  onJump,
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
