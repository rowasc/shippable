import "./AgentContextSection.css";
import { useEffect, useState } from "react";
import type {
  AgentContextSlice,
  AgentSessionRef,
  Cursor,
} from "../types";
import type { SymbolIndex } from "../symbols";
import { fetchInboxStatus, type HookStatus } from "../agentContextClient";

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
   * Worktree path for inbox-status polling after a send. Same value that
   * the parent uses to route `onSendToAgent` — passing it explicitly so the
   * composer can poll without reaching into the slice.
   */
  worktreePath: string;
  /**
   * Send a message to the agent's inbox. Resolves when the message has
   * landed in `<worktree>/.shippable/inbox.md`; the agent picks it up on
   * its next prompt boundary via the UserPromptSubmit hook.
   */
  onSendToAgent: (message: string) => Promise<void>;
  /**
   * Merge the UserPromptSubmit hook entry into ~/.claude/settings.json.
   * Returns whether the file was actually modified (it's idempotent if our
   * hook was already there) and the path of any backup written.
   */
  onInstallHook: () => Promise<{ didModify: boolean; backupPath: string | null }>;
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

      {hookStatus && !hookStatus.installed && (
        <HookHint
          onInstall={onInstallHook}
          partial={hookStatus.partial}
          missing={hookStatus.missing}
        />
      )}
      <SendToAgent
        worktreePath={worktreePath}
        onSend={onSendToAgent}
        onDelivered={onRefresh}
      />
    </section>
  );
}

type SendStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "queued"; sentAt: number }
  | { kind: "delivered"; deliveredAt: number; latencyMs: number }
  | { kind: "error"; message: string };

const POLL_INTERVAL_MS = 2000;
// Stop polling after this many ms in case the agent never runs again.
// 5 minutes is generous; the user can re-send to restart the wait.
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function SendToAgent({
  worktreePath,
  onSend,
  onDelivered,
}: {
  worktreePath: string;
  onSend: (m: string) => Promise<void>;
  onDelivered: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<SendStatus>({ kind: "idle" });
  // Surfaces transient poll failures (e.g. server restarting, ECONNREFUSED)
  // inline. Cleared on the next successful poll. Without this the UI looks
  // identical to "still queued" while polling is silently failing.
  const [pollError, setPollError] = useState<string | null>(null);

  // Pull sentAt out before the effect so it's part of the dep array without
  // tripping the discriminated-union narrowing. null disables the effect.
  const queuedSentAt = status.kind === "queued" ? status.sentAt : null;

  // While in "queued", poll the inbox file. The hook deletes it when it
  // fires, so disappearance = "delivered to a fresh prompt." Effect body
  // stays sync-setState-free; the setIntervals are async callbacks.
  useEffect(() => {
    if (queuedSentAt === null) return;
    const sentAt = queuedSentAt;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - sentAt > POLL_TIMEOUT_MS) {
        // Stop polling; leave status at queued. User can re-send to retry.
        window.clearInterval(id);
        return;
      }
      try {
        const s = await fetchInboxStatus(worktreePath);
        if (cancelled) return;
        setPollError(null);
        if (!s.exists) {
          const now = Date.now();
          setStatus({
            kind: "delivered",
            deliveredAt: now,
            latencyMs: now - sentAt,
          });
          window.clearInterval(id);
          onDelivered();
        }
      } catch (e) {
        if (cancelled) return;
        // Surface the failure but keep polling — server probably restarting.
        const msg = e instanceof Error ? e.message : String(e);
        setPollError(/ECONNREFUSED|HTTP/.test(msg) ? "server unreachable" : msg);
      }
    };
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    void tick(); // immediate first check
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [queuedSentAt, worktreePath, onDelivered]);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setStatus({ kind: "sending" });
    try {
      await onSend(body);
      setDraft("");
      setStatus({ kind: "queued", sentAt: Date.now() });
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
        placeholder="Reply to the agent. Delivered on its next prompt boundary."
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
              ◌ queued — waiting for the agent's next prompt
              {pollError && (
                <span className="ac__send-pollerr"> · {pollError}</span>
              )}
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
