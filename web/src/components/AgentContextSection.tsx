import "./AgentContextSection.css";
import { useEffect, useState } from "react";
import type {
  AgentContextSlice,
  AgentSessionRef,
  Cursor,
  DeliveredComment,
} from "../types";
import type { SymbolIndex } from "../symbols";

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
  /** MCP-install detection; null while loading or unsupported. */
  mcpStatus: { installed: boolean } | null;
  /** Click on a symbol link → jump to its definition in the diff. */
  onJump: (c: Cursor) => void;
  /** Switch the active session — the parent re-fetches with the new pin. */
  onPickSession: (sessionFilePath: string) => void;
  /** Manually re-run the fetch (after an error, or to refresh on demand). */
  onRefresh: () => void;
  /**
   * Delivered comments for this worktree (newest first). Drives the
   * Delivered (N) details block between the transcript tail and the
   * composer. The list is bounded server-side at 200 — see
   * `DELIVERED_HISTORY_CAP` in `server/src/agent-queue.ts`.
   */
  delivered: DeliveredComment[];
  /**
   * ISO timestamp of the most recent successful `fetchDelivered` call.
   * `null` before any successful poll. Drives the failure-mode banner's
   * "last checked X min ago" copy.
   */
  lastSuccessfulPollAt: string | null;
  /**
   * `true` when the most recent `fetchDelivered` errored. Pips freeze
   * in last-known state; the panel-level banner surfaces the failure.
   */
  deliveredError: boolean;
  /**
   * Send a freeform message to the agent. Resolves once the comment has
   * been enqueued; the agent picks it up the next time it calls the MCP
   * pull tool (typically via the `check shippable` magic phrase). Failures
   * propagate — the composer surfaces them inline.
   */
  onSendToAgent: (message: string) => Promise<void>;
}

/** localStorage key for the "I installed it" dismiss flag. One flag per
 *  machine — not per-worktree, not per-account. */
const MCP_DISMISS_KEY = "shippable.mcpInstallDismissed";

export function AgentContextSection({
  slice,
  candidates,
  selectedSessionFilePath,
  loading,
  error,
  symbols,
  mcpStatus,
  onJump,
  delivered,
  lastSuccessfulPollAt,
  deliveredError,
  onPickSession,
  onRefresh,
  onSendToAgent,
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

      <McpInstallAffordance mcpStatus={mcpStatus} />

      {/* Server-restart hint — single line, rendered once when a worktree
        * is loaded. Inspector only mounts this section in that case, so
        * the hint follows the panel's lifecycle automatically. */}
      <div className="ac__restart-hint">
        Queue is in-memory — server restart drops unpulled comments.
      </div>

      {deliveredError && (
        <div className="ac__poll-banner" role="status">
          Agent status unavailable — last checked{" "}
          {lastSuccessfulPollAt ? humanAgo(lastSuccessfulPollAt) : "—"}.
        </div>
      )}

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

      <DeliveredBlock delivered={delivered} />

      <SendToAgent onSend={onSendToAgent} />
    </section>
  );
}

/**
 * Newest-first list of comments the agent has fetched. Hides at N=0 — there
 * is no Delivered block on a fresh worktree until the first ✓ flips. Reads
 * from the same polled list that drives per-reply pips, so the macro view
 * (this block) and the micro view (per-thread pip) stay in sync.
 *
 * The server caps history at 200 entries; when the cap is hit we suffix
 * "(showing last 200)" to the summary so the user knows older deliveries
 * have aged out. We treat `length === 200` as the cap-hit signal — the
 * server drops oldest beyond the cap, so the only way to land at exactly
 * 200 in a long-running session is to be at the cap.
 */
function DeliveredBlock({ delivered }: { delivered: DeliveredComment[] }) {
  if (delivered.length === 0) return null;
  const atCap = delivered.length === 200;
  return (
    <details className="ac__details ac__delivered">
      <summary className="ac__details-summary">
        Delivered ({delivered.length}){atCap && " (showing last 200)"}
      </summary>
      <ul className="ac__delivered-list">
        {delivered.map((d) => (
          <li key={d.id} className="ac__delivered-item">
            <span className="ac__delivered-loc">
              {d.kind === "freeform" ? "(freeform message)" : formatLoc(d)}
            </span>
            <span className="ac__delivered-sep"> · </span>
            <span className="ac__delivered-kind">{d.kind}</span>
            <span className="ac__delivered-sep"> · </span>
            <span className="ac__delivered-time" title={d.deliveredAt}>
              {humanAgo(d.deliveredAt)}
            </span>
            <div className="ac__delivered-body">{clipBody(d.body, 80)}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function formatLoc(d: DeliveredComment): string {
  if (!d.file) return "(no file)";
  return d.lines ? `${d.file}:${d.lines}` : d.file;
}

function clipBody(body: string, max: number): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + "…";
}

type SendStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string };

function SendToAgent({
  onSend,
}: {
  onSend: (m: string) => Promise<void>;
}) {
  // Slice 5 collapsed the legacy inbox-file polling. The composer now
  // simply enqueues — once the agent calls the MCP tool, the message
  // appears in the Delivered (N) block via the slice-4 polling hook.
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<SendStatus>({ kind: "idle" });

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setStatus({ kind: "sending" });
    try {
      await onSend(body);
      setDraft("");
      setStatus({ kind: "idle" });
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
          if (status.kind === "error") setStatus({ kind: "idle" });
        }}
        placeholder="Reply to the agent. Delivered when the agent runs `check shippable`."
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

// ── MCP install affordance ────────────────────────────────────────────────
//
// Renders prominently at the top of the panel when the server hasn't seen a
// `shippable` MCP entry in the user's Claude Code config and the user
// hasn't manually dismissed the prompt. Two click-to-copy boxes: the
// install command and the magic phrase. Plus an "I installed it" dismiss
// button — for harnesses we can't programmatically detect, that's the only
// way to clear the prompt.
//
// Detection is an `installed: boolean` from the server. The component's own
// "I'm installed" derivation is `mcpStatus.installed === true OR the user
// dismissed it locally". Either path collapses to a one-line ✓ marker.

const INSTALL_LINE_CC = "claude mcp add shippable -- npx -y @shippable/mcp-server";
const MAGIC_PHRASE = "check shippable";

function McpInstallAffordance({
  mcpStatus,
}: {
  mcpStatus: { installed: boolean } | null;
}) {
  // Read the dismiss flag synchronously on mount so the install section
  // doesn't briefly flash for users who already dismissed.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(MCP_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  // While mcpStatus is still loading and the user hasn't dismissed yet,
  // render nothing — better than a flash of "set up" copy that disappears
  // when the fetch lands.
  if (mcpStatus === null && !dismissed) return null;

  if ((mcpStatus && mcpStatus.installed) || dismissed) {
    return (
      <div className="ac__mcp ac__mcp--ok">
        <span className="ac__mcp-ok">✓</span>
        <span className="ac__mcp-ok-text">MCP installed</span>
      </div>
    );
  }

  function dismiss() {
    try {
      window.localStorage.setItem(MCP_DISMISS_KEY, "1");
    } catch {
      // Best-effort: if storage is wedged the panel keeps re-rendering the
      // affordance, which is annoying but not broken.
    }
    setDismissed(true);
  }

  return (
    <div className="ac__mcp">
      <div className="ac__mcp-line">
        <span className="ac__mcp-icon" aria-hidden>
          ⚙
        </span>
        <span className="ac__mcp-text">
          Install the Shippable MCP server so your agent can fetch review
          comments.
        </span>
      </div>
      <div className="ac__mcp-row">
        <div className="ac__mcp-label">Install:</div>
        <CopyChip text={INSTALL_LINE_CC} />
      </div>
      <div className="ac__mcp-row">
        <div className="ac__mcp-label">Then say:</div>
        <CopyChip text={MAGIC_PHRASE} />
      </div>
      <div className="ac__mcp-actions">
        <button
          className="ac__mcp-dismiss"
          onClick={dismiss}
          title="hide this prompt — persisted per-machine"
        >
          I installed it
        </button>
      </div>
    </div>
  );
}

/** Click-to-copy chip with a brief "copied ✓" feedback. */
function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  // Cancel the timer on unmount so we don't setState after the panel
  // re-renders without us.
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard denied (insecure context, permission, etc.). Leave the
      // state alone so the user can copy by hand.
    }
  }

  return (
    <button
      type="button"
      className={`ac__mcp-chip${copied ? " ac__mcp-chip--copied" : ""}`}
      onClick={() => void copy()}
      title="click to copy"
    >
      <code className="ac__mcp-chip-code">{text}</code>
      <span className="ac__mcp-chip-feedback">
        {copied ? "copied ✓" : "copy"}
      </span>
    </button>
  );
}

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
