import { useEffect, useRef, useState } from "react";
import "./DetachedThreadCard.css";
import type { DetachedThreadRowItem } from "../view";
import type { Cursor, DeliveredInteraction } from "../types";
import type { SymbolIndex } from "../symbols";
import { CodeText } from "./CodeText";
import { fetchFileAt } from "../fileAt";
import { guessLanguage } from "../parseDiff";
import { ReplyThread } from "./ReplyThread";

interface Props {
  row: DetachedThreadRowItem;
  symbols: SymbolIndex;
  /**
   * Worktree path the detached thread came from. Required for the
   * "view at <sha7>" affordance; null disables it (legacy / non-worktree).
   */
  worktreePath: string | null;
  deliveredById?: Record<string, DeliveredInteraction>;
  /** True when a draft composer is open on this thread's key. */
  isDrafting: boolean;
  /** Current draft body for this thread (persists across composer close/reopen). */
  draftBody: string;
  onJump: (c: Cursor) => void;
  onStartDraft: () => void;
  onCloseDraft: () => void;
  onChangeDraft: (body: string) => void;
  onSubmitReply: (body: string) => void;
  onDeleteReply: (replyId: string) => void;
  onRetryReply?: (replyId: string) => void;
}

/**
 * A single detached-thread card. Reads like a normal thread (snippet +
 * ReplyThread) but the head badge spells out that the anchor is gone.
 * Replies are allowed — the conversation can continue under the original
 * threadKey even when the line is gone; the enqueue path no-ops on
 * unresolvable keys so locally posted replies stay local.
 */
export function DetachedThreadCard({
  row,
  symbols,
  worktreePath,
  deliveredById,
  isDrafting,
  draftBody,
  onJump,
  onStartDraft,
  onCloseDraft,
  onChangeDraft,
  onSubmitReply,
  onDeleteReply,
  onRetryReply,
}: Props) {
  const anchorless = !row.anchorPath;
  const whereLabel = anchorless
    ? "(unknown file)"
    : `was at ${row.anchorPath}${row.anchorLineNo ? `:L${row.anchorLineNo}` : ""}`;
  const canViewAt =
    row.originType === "committed" &&
    !!row.originSha &&
    !!worktreePath &&
    !anchorless;
  const [open, setOpen] = useState(false);
  return (
    <li className="detached-entry">
      <div className="detached-entry__head">
        <span className="detached-entry__badge" title="the line this comment targeted is no longer in the diff">
          ⛓ reference lost
        </span>
        <span className="detached-entry__where">{whereLabel}</span>
        {canViewAt && (
          <button
            type="button"
            className="detached-entry__view-at"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title={`view ${row.anchorPath} at ${row.originSha7}`}
          >
            {open ? "hide" : "view at"} {row.originSha7}
          </button>
        )}
      </div>
      {row.snippetLines.length > 0 && (
        <pre className="detached-entry__snippet">
          {row.snippetLines.map((l) => `${l.sign} ${l.text}`).join("\n")}
        </pre>
      )}
      <ReplyThread
        interactions={row.replies}
        isDrafting={isDrafting}
        draftBody={draftBody}
        onStartDraft={onStartDraft}
        onCloseDraft={onCloseDraft}
        onChangeDraft={onChangeDraft}
        onSubmitReply={onSubmitReply}
        onDeleteReply={onDeleteReply}
        onRetryReply={onRetryReply}
        symbols={symbols}
        onJump={onJump}
        deliveredById={deliveredById}
      />
      {open && canViewAt && (
        <ViewAtPanel
          worktreePath={worktreePath!}
          sha={row.originSha}
          file={row.anchorPath}
          anchorLineNo={row.anchorLineNo}
        />
      )}
    </li>
  );
}

interface ViewAtPanelProps {
  worktreePath: string;
  sha: string;
  file: string;
  anchorLineNo?: number;
}

/**
 * Inline panel rendering a file at a specific commit. Fetches once on mount
 * via /api/worktrees/file-at and scrolls the anchor line into the middle of
 * the scroll viewport. Sized to a fixed height so a long file doesn't
 * dominate the surrounding card; the user scrolls within the panel.
 */
function ViewAtPanel({ worktreePath, sha, file, anchorLineNo }: ViewAtPanelProps) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; lines: string[] }
    | { kind: "err"; message: string }
  >({ kind: "loading" });
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFileAt({ worktreePath, sha, file })
      .then((content) => {
        if (cancelled) return;
        const lines = splitLines(content);
        setState({ kind: "ok", lines });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "err", message });
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePath, sha, file]);

  useEffect(() => {
    if (state.kind !== "ok") return;
    const el = anchorRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center" });
  }, [state.kind]);

  if (state.kind === "loading") {
    return (
      <div className="view-at-panel view-at-panel--status">loading…</div>
    );
  }
  if (state.kind === "err") {
    return (
      <div className="view-at-panel view-at-panel--status view-at-panel--err">
        couldn’t load: {state.message}
      </div>
    );
  }

  const language = guessLanguage(file);
  return (
    <div className="view-at-panel">
      <pre className="view-at-panel__code">
        {state.lines.map((text, i) => {
          const lineNo = i + 1;
          const isAnchor = anchorLineNo === lineNo;
          return (
            <span
              key={i}
              ref={isAnchor ? anchorRef : null}
              className={`view-at-line ${isAnchor ? "view-at-line--anchor" : ""}`}
            >
              <span className="view-at-line__no">{lineNo}</span>
              <span className="view-at-line__text">
                <CodeText text={text} language={language} />
              </span>
              {"\n"}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  // `git show` content always carries the file's trailing newline; split
  // leaves a stray empty entry — drop it so the line count matches what a
  // user expects.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
