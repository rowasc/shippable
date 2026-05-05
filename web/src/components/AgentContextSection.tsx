import "./AgentContextSection.css";
import { useEffect, useMemo, useState } from "react";
import type {
  AgentContextSlice,
  AgentSessionRef,
  Cursor,
  DeliveredComment,
} from "../types";
import type { SymbolIndex } from "../symbols";
import {
  fetchDelivered,
  type HookStatus,
} from "../agentContextClient";
import type { UnsentEntry } from "../sendBatch";
import { renderPreviewPayload } from "../sendBatch";

interface Props {
  slice: AgentContextSlice | null;
  /** All sessions matched to this worktree (for the picker). */
  candidates: AgentSessionRef[];
  /** Current session file path so the picker knows what's selected. */
  selectedSessionFilePath: string | null;
  /** Loading state from the parent's fetch effect. */
  loading: boolean;
  /** Last error from the fetch, if any. */
  error: string | null;
  /**
   * Symbols defined by the current diff. Backtick-quoted spans in chat that
   * exact-match a known symbol become click-throughs into the diff. Symbols
   * not in this index render as plain `<code>` — that's the false-positive
   * guard.
   */
  symbols: SymbolIndex;
  /** Hook-installation status; null while loading or unsupported. */
  hookStatus: HookStatus | null;
  /** Click on a symbol link → jump to its definition in the diff. */
  onJump: (c: Cursor) => void;
  /** Switch the active session — the parent re-fetches with the new pin. */
  onPickSession: (sessionFilePath: string) => void;
  /** Manually re-run the fetch (after an error, or to refresh on demand). */
  onRefresh: () => void;
  /**
   * Worktree path; threaded through for the Delivered (N) block's fetch.
   * Same value that the parent uses to route `onSendToAgent`.
   */
  worktreePath: string;
  /**
   * Enqueue a freeform message for the agent. Resolves to the server-assigned
   * comment id; the composer stores that id in the App-level pending-freeform
   * tracker so the existing slice-(c) polling loop flips its status to
   * delivered once the hook acks the pull. See App.tsx for the wiring.
   */
  onSendToAgent: (message: string) => Promise<string>;
  /**
   * Merge the UserPromptSubmit hook entry into ~/.claude/settings.json.
   * Returns whether the file was actually modified (it's idempotent if our
   * hook was already there) and the path of any backup written.
   */
  onInstallHook: () => Promise<{ didModify: boolean; backupPath: string | null }>;
  /**
   * Reviewer-authored replies that haven't been pushed to the agent queue
   * yet. Drives the Send-batch button + preview sheet. Empty array hides
   * the button entirely.
   */
  unsent: UnsentEntry[];
  /** Commit sha for the active changeset; required when sending a batch. */
  commitSha: string;
  /**
   * Enqueue the selected replies. Returns the server-assigned ids in the
   * same order as the input so the parent can stamp `sentToAgentId` on the
   * matching local replies.
   */
  onEnqueueComments: (selected: UnsentEntry[]) => Promise<string[]>;
  /**
   * Refresh signal for the Delivered (N) block. Pass the size of the
   * App-level `deliveredIds` set: the delivered block re-fetches whenever
   * this number changes (i.e. the polling loop saw a new transition) so
   * we don't run a duplicate timer here just to populate read-only history.
   */
  deliveredIdsTick: number;
  /**
   * App-level set of server-confirmed delivered comment ids for the active
   * worktree. The freeform composer watches this set for its own enqueued id
   * to flip from `◌ queued` → `✓ delivered` — same delivery signal the
   * per-thread pips use, just observed by id.
   */
  deliveredIds: Set<string>;
}

export function AgentContextSection({
  slice,
  candidates,
  selectedSessionFilePath,
  loading,
  error,
  symbols,
  hookStatus,
  onJump,
  worktreePath,
  onPickSession,
  onRefresh,
  onSendToAgent,
  onInstallHook,
  unsent,
  commitSha,
  onEnqueueComments,
  deliveredIdsTick,
  deliveredIds,
}: Props) {
  // Note: we deliberately don't early-return on "no slice + no candidates";
  // Inspector only renders this section when the active changeset has a
  // worktreeSource, and in that case the user expects to see the panel even
  // when no Claude Code session matched. The empty state below carries that.

  return (
    <section className="inspector__sec ac">
      <div className="inspector__sec-h ac__h">
        <span>Agent context</span>
        {slice && (
          <span className="inspector__sec-count ac__live" title={`last event: ${slice.session.lastEventAt}`}>
            {isLive(slice.session.lastEventAt) ? "● live" : "○ idle"}
          </span>
        )}
        <button
          className="inspector__sec-jump ac__refresh"
          onClick={onRefresh}
          disabled={loading}
          title="re-fetch the agent-context slice"
        >
          {loading ? "…" : "↻"}
        </button>
      </div>

      {error && (
        <div className="ac__err">
          {error} <button className="ac__err-retry" onClick={onRefresh}>retry</button>
        </div>
      )}

      {!slice && !loading && !error && (
        <div className="inspector__empty">No Claude Code session matched this worktree.</div>
      )}

      {loading && !slice && (
        <div className="inspector__empty">Reading transcripts…</div>
      )}

      {slice && (
        <>
          <SessionLine
            slice={slice}
            candidates={candidates}
            selectedSessionFilePath={selectedSessionFilePath}
            onPick={onPickSession}
          />
          <TaskBlock
            task={slice.task}
            followUps={slice.followUps}
            symbols={symbols}
            onJump={onJump}
          />
          <FilesTouched files={slice.filesTouched} />
          {slice.todos.length > 0 && <TodosBlock todos={slice.todos} />}
          <TranscriptBlock
            messages={slice.messages}
            symbols={symbols}
            onJump={onJump}
          />
          <Footer slice={slice} />
        </>
      )}

      <DeliveredBlock
        worktreePath={worktreePath}
        deliveredIdsTick={deliveredIdsTick}
      />

      {hookStatus && !hookStatus.installed && (
        <HookHint
          onInstall={onInstallHook}
          partial={hookStatus.partial}
          missing={hookStatus.missing}
        />
      )}
      <SendBatch
        unsent={unsent}
        commitSha={commitSha}
        onEnqueue={onEnqueueComments}
      />
      <SendToAgent
        onSend={onSendToAgent}
        deliveredIds={deliveredIds}
        onDelivered={onRefresh}
      />
    </section>
  );
}

/**
 * Read-only "did the agent see this?" history. Renders a collapsed
 * `<details>` block listing comments the server reports as delivered for
 * the active worktree.
 *
 * Self-contained state: we fetch once on mount and again whenever
 * `deliveredIdsTick` changes — that prop is wired to the size of the
 * App-level `deliveredIds` set, which only grows when the slice (c)
 * polling loop confirms a new delivery. Re-using that signal means we
 * don't run a second polling timer just to populate this history.
 *
 * Hidden entirely when no worktree is loaded or when the delivered list
 * is empty (per § 6 empty-state polish in push-review-comments-tasks.md).
 * The server caps history at 200 (slice (a)); we surface that with a
 * "(showing last 200)" hint so the count is honest.
 */
function DeliveredBlock({
  worktreePath,
  deliveredIdsTick,
}: {
  worktreePath: string | null;
  deliveredIdsTick: number;
}) {
  const [delivered, setDelivered] = useState<DeliveredComment[]>([]);

  useEffect(() => {
    if (!worktreePath) return;
    let cancelled = false;
    fetchDelivered(worktreePath)
      .then((d) => {
        if (cancelled) return;
        // Server contract: newest first. Sort defensively in case a future
        // change reorders the response — the block is purely read-only,
        // so trusting the wire shape would be a silent regression risk.
        const sorted = [...d].sort((a, b) =>
          a.deliveredAt < b.deliveredAt ? 1 : a.deliveredAt > b.deliveredAt ? -1 : 0,
        );
        setDelivered(sorted);
      })
      .catch(() => {
        // Server unreachable — leave the previous state in place. The block
        // self-heals on the next tick (mount, worktree change, or a new
        // delivered transition signaled by the App-level polling loop).
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePath, deliveredIdsTick]);

  if (!worktreePath) return null;
  // Empty-state polish: hide entirely at N=0. Don't render "Delivered (0)".
  if (delivered.length === 0) return null;

  // Server caps history at 200. When we hit that cap the count alone is
  // misleading ("there could be more"), so surface the limit inline.
  const capHit = delivered.length >= 200;

  return (
    <details className="ac__details ac__delivered">
      <summary className="ac__details-summary">
        Delivered ({delivered.length})
        {capHit && (
          <span className="ac__delivered-cap"> (showing last 200)</span>
        )}
      </summary>
      <ul className="ac__delivered-list">
        {delivered.map((c) => (
          <li key={c.id} className="ac__delivered-row">
            <div className="ac__delivered-meta">
              {deliveredLocLabel(c)} · {c.kind} · {humanRelative(c.deliveredAt)}
            </div>
            <div className="ac__delivered-body" title={c.body}>
              {clip(c.body, 120)}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function deliveredLocLabel(c: DeliveredComment): string {
  if (c.file === undefined) return "freeform";
  if (!c.lines) return c.file;
  return `${c.file}:${c.lines}`;
}

/**
 * Relative-time helper for the Delivered list. The existing `humanAgo` in
 * this file collapses anything under a minute to "just now" — too coarse
 * for a delivery feed where the most recent row is usually only seconds
 * old. We use second granularity here and scale up matching `humanAgo`'s
 * thresholds above that.
 */
function humanRelative(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "?";
  const diff = Date.now() - ms;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

type BatchStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "queued"; sentAt: number; count: number }
  | { kind: "error"; message: string };

/**
 * Sends every reviewer-authored reply that hasn't been pushed to the agent
 * queue yet, with a default-on per-row checkbox so the user can deselect
 * before confirming. The button hides when `unsent` is empty.
 *
 * The "What the agent will see" toggle re-uses the same sort + sanitization
 * rules as the server formatter (see sendBatch.ts) so the preview matches
 * what the hook eventually emits.
 */
function SendBatch({
  unsent,
  commitSha,
  onEnqueue,
}: {
  unsent: UnsentEntry[];
  commitSha: string;
  onEnqueue: (selected: UnsentEntry[]) => Promise<string[]>;
}) {
  const [open, setOpen] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  // Selection state, keyed by reply-id (which is unique even across threads
  // because reply ids are minted with `r-${Date.now()}`).
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<BatchStatus>({ kind: "idle" });

  // Reset selection when the unsent list changes (user added/removed a
  // reply, or sent some). Uses the "adjust state during render" pattern
  // — mirrors the rest of this codebase's transitions, lint-friendly.
  const unsentIds = unsent.map((e) => e.reply.id).join("|");
  const [lastUnsentIds, setLastUnsentIds] = useState(unsentIds);
  if (lastUnsentIds !== unsentIds) {
    setLastUnsentIds(unsentIds);
    if (excluded.size > 0) setExcluded(new Set());
  }

  const selected = useMemo(
    () => unsent.filter((e) => !excluded.has(e.reply.id)),
    [unsent, excluded],
  );

  const previewPayload = useMemo(
    () => renderPreviewPayload(commitSha, selected.map((e) => e.comment)),
    [commitSha, selected],
  );

  if (
    unsent.length === 0 &&
    status.kind !== "queued" &&
    status.kind !== "error"
  ) {
    // Empty-state polish: hide the affordance entirely. The user has
    // nothing to send; surfacing "Send 0" would be noise. We deliberately
    // keep the panel mounted while the result banner ("queued" / "error")
    // still has something to say, even if `unsent` was concurrently
    // cleared by another path — otherwise the user would lose the
    // confirmation/error message with no way to recover it.
    return null;
  }

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirm() {
    if (selected.length === 0) return;
    setStatus({ kind: "sending" });
    try {
      await onEnqueue(selected);
      setStatus({
        kind: "queued",
        sentAt: Date.now(),
        count: selected.length,
      });
      setOpen(false);
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Group entries by file for the preview list. Freeform (no file) goes
  // last under a synthetic header; line-numbered entries above it.
  const grouped = groupByFile(unsent);

  return (
    <div className="ac__batch">
      {unsent.length > 0 && (
        <>
          <button
            className="ac__batch-btn"
            onClick={() => {
              setOpen((v) => !v);
              // Reopening after an error path: reset to idle so the button
              // text isn't stuck on "error".
              if (status.kind === "error") setStatus({ kind: "idle" });
            }}
            disabled={status.kind === "sending"}
          >
            {status.kind === "sending"
              ? "Sending…"
              : `Send ${unsent.length} comment${unsent.length === 1 ? "" : "s"}`}
          </button>
          <div className="ac__batch-hint">
            Queue is in-memory — server restart drops unpulled comments.
          </div>
        </>
      )}
      {status.kind === "queued" && (
        <div className="ac__batch-result">
          {status.count} comment{status.count === 1 ? "" : "s"} queued —
          delivers on the agent's next tool call or session start.
        </div>
      )}
      {status.kind === "error" && (
        <div className="ac__batch-result ac__batch-result--err">
          Send failed: {status.message}. Replies stay unsent — try again.
        </div>
      )}
      {open && unsent.length > 0 && (
        <div className="ac__batch-sheet">
          <div className="ac__batch-sheet-h">
            Preview ({selected.length}/{unsent.length} selected)
            <button
              className="ac__batch-toggle-payload"
              onClick={() => setShowPayload((v) => !v)}
            >
              {showPayload ? "show rows" : "what the agent will see"}
            </button>
          </div>
          {showPayload ? (
            <pre className="ac__batch-payload">
              {previewPayload || "(no comments selected)"}
            </pre>
          ) : (
            <ul className="ac__batch-list">
              {grouped.map((g) => (
                <li key={g.label} className="ac__batch-group">
                  <div className="ac__batch-group-h">{g.label}</div>
                  <ul className="ac__batch-rows">
                    {g.entries.map((e) => (
                      <li key={e.reply.id} className="ac__batch-row">
                        <label className="ac__batch-row-label">
                          <input
                            type="checkbox"
                            checked={!excluded.has(e.reply.id)}
                            onChange={() => toggle(e.reply.id)}
                          />
                          <span className="ac__batch-row-loc">
                            {locLabel(e)}
                          </span>
                          <span className="ac__batch-row-body">
                            {clip(e.reply.body, 80)}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <div className="ac__batch-foot">
            <span className="ac__batch-foot-note">
              Server orders by file/line; freeform last. Rows are not
              reorderable.
            </span>
            <button
              className="ac__batch-cancel"
              onClick={() => setOpen(false)}
              disabled={status.kind === "sending"}
            >
              cancel
            </button>
            <button
              className="ac__batch-confirm"
              onClick={() => void confirm()}
              disabled={
                status.kind === "sending" || selected.length === 0
              }
            >
              {status.kind === "sending"
                ? "Sending…"
                : `Send ${selected.length}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function groupByFile(
  entries: UnsentEntry[],
): Array<{ label: string; entries: UnsentEntry[] }> {
  const fileGroups = new Map<string, UnsentEntry[]>();
  const freeform: UnsentEntry[] = [];
  for (const e of entries) {
    if (e.comment.file === undefined) {
      freeform.push(e);
      continue;
    }
    const arr = fileGroups.get(e.comment.file);
    if (arr) arr.push(e);
    else fileGroups.set(e.comment.file, [e]);
  }
  const out: Array<{ label: string; entries: UnsentEntry[] }> = [];
  for (const path of [...fileGroups.keys()].sort()) {
    out.push({ label: path, entries: fileGroups.get(path)! });
  }
  if (freeform.length > 0) {
    out.push({ label: "(freeform)", entries: freeform });
  }
  return out;
}

function locLabel(e: UnsentEntry): string {
  if (e.comment.file === undefined) return "freeform";
  if (!e.comment.lines) return "?";
  return `L${e.comment.lines}`;
}

function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

type SendStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "queued"; sentAt: number; id: string }
  | { kind: "delivered"; latencyMs: number }
  | { kind: "error"; message: string };

// Stop waiting after this many ms in case the agent never runs again. The
// App-level polling loop stays alive on its own cadence, but the composer
// surfaces a "didn't deliver" hint so the reviewer can re-send. 5 minutes
// matches the older inbox-file polling timeout this code replaced.
const DELIVERED_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Freeform reviewer→agent composer. Slice (e) migrated this off the
 * file-based inbox onto the agent queue: `onSend` enqueues a single
 * `kind: "freeform"` comment, returns the server-assigned id, and the
 * App-level slice-(c) polling loop flips it from queued → delivered by
 * watching for that id in the `deliveredIds` set. We deliberately don't
 * run our own polling timer here — the App loop already polls
 * `/api/agent/delivered` whenever any pending id is unconfirmed (the
 * freeform id rides that same loop via the App's `pendingFreeformIds`
 * tracker; see App.tsx).
 *
 * Status flow stays identical to the old composer from the user's seat:
 * `idle → sending → queued → delivered/error`.
 */
function SendToAgent({
  onSend,
  deliveredIds,
  onDelivered,
}: {
  onSend: (m: string) => Promise<string>;
  deliveredIds: Set<string>;
  onDelivered: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<SendStatus>({ kind: "idle" });

  // Watch the App-level deliveredIds set for the id we enqueued. When it
  // shows up, flip to delivered. The check + setState happen in an effect
  // through a microtask (queueMicrotask) so the setState fires *after* the
  // render commits — that satisfies the lint rule against sync setState in
  // effect bodies and avoids `Date.now()` during render.
  const queuedId = status.kind === "queued" ? status.id : null;
  const queuedSentAt = status.kind === "queued" ? status.sentAt : null;
  const isDelivered =
    queuedId !== null && deliveredIds.has(queuedId);
  useEffect(() => {
    if (!isDelivered || queuedSentAt === null) return;
    const latency = Date.now() - queuedSentAt;
    queueMicrotask(() => {
      setStatus((cur) =>
        cur.kind === "queued"
          ? { kind: "delivered", latencyMs: latency }
          : cur,
      );
      onDelivered();
    });
  }, [isDelivered, queuedSentAt, onDelivered]);

  // Idle deadline: if the App-level polling loop hasn't seen the delivery
  // within 5 minutes, surface a timeout error. The loop keeps running, so
  // a late delivery still populates the Delivered (N) history block — only
  // this composer's own status caps out.
  useEffect(() => {
    if (queuedId === null || queuedSentAt === null) return;
    const remaining = Math.max(
      0,
      DELIVERED_TIMEOUT_MS - (Date.now() - queuedSentAt),
    );
    const t = window.setTimeout(() => {
      setStatus((cur) =>
        cur.kind === "queued" && cur.id === queuedId
          ? {
              kind: "error",
              message:
                "delivery timed out — agent didn't run a tool in 5 minutes.",
            }
          : cur,
      );
    }, remaining);
    return () => window.clearTimeout(t);
  }, [queuedId, queuedSentAt]);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setStatus({ kind: "sending" });
    try {
      const id = await onSend(body);
      setDraft("");
      setStatus({ kind: "queued", sentAt: Date.now(), id });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <div className="ac__send">
      <div className="ac__label">Send to agent</div>
      <textarea
        className="ac__send-textarea"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (status.kind !== "sending" && status.kind !== "queued") {
            setStatus({ kind: "idle" });
          }
        }}
        placeholder="Reply to the agent. Delivered on its next tool call or session start."
        rows={3}
        disabled={status.kind === "sending"}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="ac__send-row">
        <button
          className="ac__send-btn"
          onClick={() => void submit()}
          disabled={status.kind === "sending" || draft.trim().length === 0}
        >
          {status.kind === "sending" ? "Sending…" : "Send"}
        </button>
        <span className="ac__send-status">
          {status.kind === "queued" && (
            <span className="ac__send-queued">
              ◌ queued — delivers on the agent's next tool call or session start
            </span>
          )}
          {status.kind === "delivered" && (
            <span className="ac__send-delivered">
              ✓ delivered ({humanLatency(status.latencyMs)})
            </span>
          )}
          {status.kind === "error" && (
            <span className="ac__send-err">error: {status.message}</span>
          )}
          {status.kind === "idle" && (
            <span className="ac__send-hint">⌘↵ to send</span>
          )}
        </span>
      </div>
    </div>
  );
}

function humanLatency(ms: number): string {
  if (ms < 1000) return `<1s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/**
 * "Live" if the matched session has produced an event in the last 60s.
 * Threshold lives here for now — see docs/features/agent-context-panel.md.
 */
function isLive(lastEventAt: string): boolean {
  const ms = Date.parse(lastEventAt);
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms < 60_000;
}

function SessionLine({
  slice,
  candidates,
  selectedSessionFilePath,
  onPick,
}: {
  slice: AgentContextSlice;
  candidates: AgentSessionRef[];
  selectedSessionFilePath: string | null;
  onPick: (filePath: string) => void;
}) {
  const ago = humanAgo(slice.session.startedAt);
  const taskTitle = slice.session.taskTitle ?? "(untitled session)";
  if (candidates.length <= 1) {
    return (
      <div className="ac__sub">
        from session <em>"{truncate(taskTitle, 60)}"</em> · started {ago}
      </div>
    );
  }
  return (
    <div className="ac__sub">
      <select
        className="ac__sess-select"
        value={selectedSessionFilePath ?? slice.session.filePath}
        onChange={(e) => onPick(e.target.value)}
        title="multiple Claude Code sessions ran in this worktree — pick one"
      >
        {candidates.map((s) => (
          <option key={s.filePath} value={s.filePath}>
            {truncate(s.taskTitle ?? s.sessionId, 60)} · {humanAgo(s.startedAt)}
          </option>
        ))}
      </select>
    </div>
  );
}

function TaskBlock({
  task,
  followUps,
  symbols,
  onJump,
}: {
  task: string | null;
  followUps: string[];
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
}) {
  if (!task && followUps.length === 0) return null;
  return (
    <div className="ac__block">
      <div className="ac__label">Task</div>
      {task && (
        <p className="ac__task">
          <MessageText text={task} symbols={symbols} onJump={onJump} />
        </p>
      )}
      {followUps.length > 0 && (
        <details className="ac__details">
          <summary className="ac__details-summary">
            + {followUps.length} follow-up{followUps.length === 1 ? "" : "s"}
          </summary>
          <ul className="ac__followups">
            {followUps.map((f, i) => (
              <li key={i}>
                <MessageText text={f} symbols={symbols} onJump={onJump} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FilesTouched({ files }: { files: string[] }) {
  if (files.length === 0) return null;
  return (
    <div className="ac__block">
      <div className="ac__label">Files touched ({files.length})</div>
      <ul className="ac__files">
        {files.map((f) => (
          <li key={f} className="ac__file" title={f}>
            {basename(f)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TodosBlock({ todos }: { todos: { content: string; status: "pending" | "in_progress" | "completed" }[] }) {
  return (
    <details className="ac__details">
      <summary className="ac__details-summary">
        Plan ({todos.filter((t) => t.status === "completed").length}/{todos.length})
      </summary>
      <ul className="ac__todos">
        {todos.map((t, i) => (
          <li key={i} className={`ac__todo ac__todo--${t.status}`}>
            <span className="ac__todo-marker">
              {t.status === "completed" ? "✓" : t.status === "in_progress" ? "▸" : "·"}
            </span>
            <span className="ac__todo-text">{t.content}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function TranscriptBlock({
  messages,
  symbols,
  onJump,
}: {
  messages: { role: string; text: string; toolCalls: { oneLine: string }[] }[];
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
}) {
  if (messages.length === 0) return null;
  // Show the last few messages by default; expand for the full slice. We
  // keep 6 here to capture user/assistant alternation rather than just
  // assistant turns.
  const tail = messages.slice(-6);
  return (
    <details className="ac__details">
      <summary className="ac__details-summary">
        Transcript tail ({messages.length} message{messages.length === 1 ? "" : "s"})
      </summary>
      <ul className="ac__msgs">
        {tail.map((m, i) => (
          <li key={i} className={`ac__msg ac__msg--${m.role}`}>
            <div className="ac__msg-role">{m.role}</div>
            {m.text && (
              <div className="ac__msg-text">
                <MessageText
                  text={truncate(m.text, 400)}
                  symbols={symbols}
                  onJump={onJump}
                />
              </div>
            )}
            {m.toolCalls.length > 0 && (
              <ul className="ac__tools">
                {m.toolCalls.map((tc, j) => (
                  <li key={j} className="ac__tool">
                    {truncate(tc.oneLine, 80)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Backtick-only tokenizer for chat content. We deliberately do not link
 * bare identifiers (those produce too many false positives in narrative
 * text). A backtick-quoted span that exact-matches a symbol defined in the
 * loaded ChangeSet becomes a click-through; everything else stays prose.
 *
 * Why no `RichText` reuse: that component links bare identifiers too,
 * which is the right call for AI plan output but the wrong call here.
 */
function MessageText({
  text,
  symbols,
  onJump,
}: {
  text: string;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
}) {
  const parts = tokenizeBackticks(text, symbols);
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "text") return <span key={i}>{p.text}</span>;
        if (p.kind === "code")
          return (
            <code key={i} className="ac__code">
              {p.text}
            </code>
          );
        return (
          <button
            key={i}
            className="ac__sym"
            onClick={() => onJump(p.target)}
            title={`jump to ${p.text}`}
          >
            {p.text}
          </button>
        );
      })}
    </>
  );
}

type MsgPart =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "symbol"; text: string; target: Cursor };

const TICK_RE = /`([^`\n]+)`/g;

function tokenizeBackticks(text: string, symbols: SymbolIndex): MsgPart[] {
  const out: MsgPart[] = [];
  let lastEnd = 0;
  for (const m of text.matchAll(TICK_RE)) {
    const start = m.index ?? 0;
    if (start > lastEnd) {
      out.push({ kind: "text", text: text.slice(lastEnd, start) });
    }
    const inner = m[1];
    const target = symbols.get(inner.trim());
    if (target) {
      out.push({ kind: "symbol", text: inner, target });
    } else {
      out.push({ kind: "code", text: inner });
    }
    lastEnd = start + m[0].length;
  }
  if (lastEnd < text.length) {
    out.push({ kind: "text", text: text.slice(lastEnd) });
  }
  return out;
}

function HookHint({
  onInstall,
  partial,
  missing,
}: {
  onInstall: () => Promise<{ didModify: boolean; backupPath: string | null }>;
  partial: boolean;
  missing: string[];
}) {
  const [open, setOpen] = useState(false);
  const [installState, setInstallState] = useState<
    | { kind: "idle" }
    | { kind: "installing" }
    | { kind: "done"; didModify: boolean; backupPath: string | null }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(HOOK_SNIPPET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function install() {
    setInstallState({ kind: "installing" });
    try {
      const res = await onInstall();
      setInstallState({
        kind: "done",
        didModify: res.didModify,
        backupPath: res.backupPath,
      });
    } catch (e) {
      setInstallState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Two messages:
  //  - Partial install: legacy / half-installed hook. Surface what's missing
  //    so the user can see the install isn't a no-op.
  //  - Not installed: nothing detected. Same affordance as before.
  const hintText = partial
    ? `Agent hook only partially installed — missing ${missing.join(", ")}.`
    : "Agent hook not detected — feedback won't reach the agent until you install it.";
  const installLabel = partial ? "Install missing" : "Install for me";

  return (
    <div className="ac__hook">
      <div className="ac__hook-line">
        <span className="ac__hook-icon" aria-hidden>
          ⚠
        </span>
        <span className="ac__hook-text">{hintText}</span>
        <button
          className="ac__hook-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "hide setup" : "set up"}
        </button>
      </div>
      {open && (
        <div className="ac__hook-body">
          <div className="ac__hook-actions">
            <button
              className="ac__hook-install"
              onClick={() => void install()}
              disabled={installState.kind === "installing"}
              title="merge the three hook entries into ~/.claude/settings.local.json"
            >
              {installState.kind === "installing"
                ? "Installing…"
                : installLabel}
            </button>
            <button className="ac__hook-copy" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy snippet"}
            </button>
            <span className="ac__hook-or">or paste manually:</span>
          </div>
          <p className="ac__hook-snippet-path">
            Add the JSON below to <code>~/.claude/settings.local.json</code>:
          </p>
          <pre className="ac__hook-snippet">{HOOK_SNIPPET}</pre>
          {installState.kind === "done" && (
            <div className="ac__hook-result">
              {installState.didModify
                ? `Done. ~/.claude/settings.local.json updated${
                    installState.backupPath
                      ? ` (backup at ${installState.backupPath}).`
                      : "."
                  }`
                : "Already installed — nothing to change."}
            </div>
          )}
          {installState.kind === "error" && (
            <div className="ac__hook-result ac__hook-result--err">
              Install failed: {installState.message}. Use the snippet above.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Pure-JSON snippet so users can paste-and-parse without stripping a `//`
// comment first (the path hint lives in JSX above the <pre> instead).
//
// This shape matches what `installHook` writes for the *default* server
// port (3001): a bare absolute path, no env prefix. Users running the
// server on a non-default PORT should use the "Install for me" button —
// the server-side install captures the resolved port and writes the
// matching `SHIPPABLE_PORT=<port> /abs/.../shippable-agent-hook` command.
// We deliberately don't fetch the resolved port to render this snippet:
// the Install button is the supported path for non-default-port users,
// and adding a fetch just to re-render this preview isn't worth the
// complexity. Keep this snippet in sync with the default-port shape in
// server/src/hook-status.ts.
const HOOK_SNIPPET = `{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "<absolute path>/tools/shippable-agent-hook"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "<absolute path>/tools/shippable-agent-hook"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "<absolute path>/tools/shippable-agent-hook"
          }
        ]
      }
    ]
  }
}`;

function Footer({ slice }: { slice: AgentContextSlice }) {
  const parts: string[] = [];
  parts.push(`${slice.messages.length} turn${slice.messages.length === 1 ? "" : "s"}`);
  if (slice.tokensIn > 0) parts.push(`${formatTokens(slice.tokensIn)} in`);
  if (slice.tokensOut > 0) parts.push(`${formatTokens(slice.tokensOut)} out`);
  if (slice.durationMs > 0) parts.push(humanDuration(slice.durationMs));
  if (slice.model) parts.push(slice.model);
  return <div className="ac__footer">{parts.join(" · ")}</div>;
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function humanAgo(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "?";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function humanDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}
