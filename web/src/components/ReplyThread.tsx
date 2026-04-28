import "./ReplyThread.css";
import { useEffect, useRef, useState } from "react";
import type { Cursor, Reply } from "../types";
import type { SymbolIndex } from "../symbols";
import { RichText } from "./RichText";

interface Props {
  replies: Reply[];
  isDrafting: boolean;
  onStartDraft: () => void;
  onCancelDraft: () => void;
  onSubmitReply: (body: string) => void;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
}

export function ReplyThread({
  replies,
  isDrafting,
  onStartDraft,
  onCancelDraft,
  onSubmitReply,
  symbols,
  onJump,
}: Props) {
  if (replies.length === 0 && !isDrafting) {
    return (
      <div className="thread thread--empty">
        <button className="thread__start" onClick={onStartDraft}>
          + reply
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
        <Composer onCancel={onCancelDraft} onSubmit={onSubmitReply} />
      ) : (
        <button className="thread__start" onClick={onStartDraft}>
          + reply
        </button>
      )}
    </div>
  );
}

function Composer({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="composer">
      <textarea
        ref={ref}
        className="composer__input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
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
          <kbd>⌘Enter</kbd> send · <kbd>Esc</kbd> cancel
        </span>
        <button className="composer__cancel" onClick={onCancel}>
          cancel
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
