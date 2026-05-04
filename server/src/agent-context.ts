import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";

// PROTOTYPE: reads Claude Code's local JSONL transcripts under
// ~/.claude/projects/<project-hash>/<session-id>.jsonl, matches them to a
// reviewer worktree by `cwd`, and slices by commit boundary so the panel UI
// can show "what the agent did for this commit". See
// docs/concepts/agent-context.md for the design rationale.
//
// Production hardening still to do: cap per-session file size, stream rather
// than buffer for very long transcripts, debounced cache keyed by file mtime,
// honest cost/usage extraction (the wire format isn't fully documented and we
// have to be defensive about every field).

const execFileAsync = promisify(execFile);
const GIT = "git"; // reuse PATH; worktrees.ts has the resolved-once binary
                   // already, but we avoid importing across module to keep this
                   // file self-contained for the prototype.

/** Where Claude Code keeps its per-project transcript directories. */
function claudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Reverse of Claude Code's project-dir naming convention.
 * `/Users/me/foo/bar` → `-Users-me-foo-bar`. Used as a fast-path lookup; we
 * still verify by reading the `cwd` field of entries inside, because a single
 * session file can span multiple cwds (e.g. after the agent enters a worktree
 * mid-session) and that would invalidate a name-only match.
 */
function encodeProjectDirName(absPath: string): string {
  if (!path.isAbsolute(absPath)) {
    throw new Error(`expected absolute path, got: ${absPath}`);
  }
  return absPath.replace(/\//g, "-");
}

export interface SessionRef {
  sessionId: string;
  filePath: string;
  startedAt: string;
  lastEventAt: string;
  /** First user message in the session (truncated for display). */
  taskTitle: string | null;
  /** Total user+assistant entries in the file (cheap to count, useful UI hint). */
  turnCount: number;
  /** All distinct cwds this session has touched. Used by the picker so the
   *  reviewer can confirm "yes, this session ran in my worktree at some point". */
  cwds: string[];
}

export interface ToolCallSummary {
  name: string;
  /** First file path argument we could extract, if any. */
  filePath: string | null;
  /** Compact one-line render — "Read web/src/foo.ts", "Edit (3 changes) ...". */
  oneLine: string;
}

export interface AgentMessage {
  uuid: string;
  role: "user" | "assistant" | "system";
  timestamp: string;
  /** Flattened text content. Multi-part messages are joined with `\n\n`. */
  text: string;
  toolCalls: ToolCallSummary[];
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface AgentContextSlice {
  session: SessionRef;
  /** Commit this slice belongs to; null when no specific commit is supplied. */
  commitSha: string | null;
  /** Inclusive lower bound of the slice (ISO). null = beginning of session. */
  fromTime: string | null;
  /** Inclusive upper bound (ISO). */
  toTime: string;
  /** Original user prompt at session start (or first user msg in slice). */
  task: string | null;
  /** Additional user messages within the slice (excluding the first one). */
  followUps: string[];
  /** Latest TodoWrite state seen within the slice. Empty if none. */
  todos: TodoItem[];
  /** All file paths tool calls touched within the slice, deduped, in order. */
  filesTouched: string[];
  /** All user/assistant messages within the slice, in order. */
  messages: AgentMessage[];
  /** Best-effort token usage. May be 0 if the wire format hides it. */
  tokensIn: number;
  tokensOut: number;
  /** Wallclock duration of the slice (ms). */
  durationMs: number;
  /** Model name from the last assistant message in the slice, if any. */
  model: string | null;
}

/**
 * List Claude Code sessions whose transcript contains at least one entry with
 * `cwd === worktreePath`. Sorted by `lastEventAt` descending so the picker can
 * default to the most recent session. Returns `[]` when no transcripts exist
 * for this path.
 */
export async function listSessionsForWorktree(
  worktreePath: string,
): Promise<SessionRef[]> {
  if (!path.isAbsolute(worktreePath)) {
    throw new Error(`worktreePath must be absolute, got: ${worktreePath}`);
  }
  const projectsRoot = claudeProjectsDir();

  // Fast-path: probe the dir we'd expect to see for this worktree path.
  const expected = path.join(projectsRoot, encodeProjectDirName(worktreePath));
  const candidateDirs: string[] = [];
  try {
    await fs.access(expected);
    candidateDirs.push(expected);
  } catch {
    // Fast-path miss is normal: the session may have been started in the main
    // repo and only switched into the worktree mid-session, in which case the
    // project dir name reflects the original cwd, not the current one.
  }

  // Always also scan all project dirs and check entries' `cwd`s. This is what
  // lets us catch sessions that crossed cwds after EnterWorktree etc.
  let allProjectDirs: string[];
  try {
    const ents = await fs.readdir(projectsRoot, { withFileTypes: true });
    allProjectDirs = ents
      .filter((e) => e.isDirectory())
      .map((e) => path.join(projectsRoot, e.name));
  } catch {
    return [];
  }
  for (const d of allProjectDirs) {
    if (!candidateDirs.includes(d)) candidateDirs.push(d);
  }

  const sessions: SessionRef[] = [];
  for (const dir of candidateDirs) {
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const filePath = path.join(dir, f);
      const ref = await summarizeSessionIfMatches(filePath, worktreePath);
      if (ref) sessions.push(ref);
    }
  }

  sessions.sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));
  return sessions;
}

/**
 * Return a SessionRef iff at least one entry in the file has `cwd ===
 * worktreePath`. Single pass over the file. Skips silently on parse errors —
 * a malformed session shouldn't break the picker for the rest.
 */
async function summarizeSessionIfMatches(
  filePath: string,
  worktreePath: string,
): Promise<SessionRef | null> {
  let matched = false;
  let sessionId = "";
  let startedAt: string | null = null;
  let lastEventAt: string | null = null;
  let taskTitle: string | null = null;
  let turnCount = 0;
  const cwds = new Set<string>();

  for await (const entry of streamJsonl(filePath)) {
    if (!entry || typeof entry !== "object") continue;
    const sid = typeof entry.sessionId === "string" ? entry.sessionId : null;
    if (sid && !sessionId) sessionId = sid;
    if (typeof entry.cwd === "string") {
      cwds.add(entry.cwd);
      if (entry.cwd === worktreePath) matched = true;
    }
    const ts = typeof entry.timestamp === "string" ? entry.timestamp : null;
    if (ts) {
      if (!startedAt || ts < startedAt) startedAt = ts;
      if (!lastEventAt || ts > lastEventAt) lastEventAt = ts;
    }
    if (entry.type === "user" || entry.type === "assistant") {
      turnCount += 1;
    }
    if (entry.type === "user" && taskTitle === null) {
      const text = flattenMessageText(entry.message);
      if (text) taskTitle = text.slice(0, 200);
    }
  }

  if (!matched) return null;
  return {
    sessionId: sessionId || path.basename(filePath, ".jsonl"),
    filePath,
    startedAt: startedAt ?? "",
    lastEventAt: lastEventAt ?? "",
    taskTitle,
    turnCount,
    cwds: [...cwds],
  };
}

/**
 * Slice a session's transcript by commit boundary.
 *
 * - If `commitSha` is supplied, the window is `(prev-commit-date, this-commit-date]`
 *   on the worktree's branch. Events outside that window are excluded.
 * - If `commitSha` is omitted, the window is `(-∞, now]` — all events.
 *
 * Events are also filtered by `cwd === worktreePath` so cross-cwd sessions
 * don't bleed in.
 */
export async function agentContextForCommit(opts: {
  worktreePath: string;
  sessionFilePath: string;
  commitSha?: string | null;
}): Promise<AgentContextSlice> {
  const { worktreePath, sessionFilePath } = opts;
  const commitSha = opts.commitSha ?? null;

  const session = await summarizeSessionIfMatches(sessionFilePath, worktreePath);
  if (!session) {
    throw new Error(
      `session ${sessionFilePath} has no entries matching cwd=${worktreePath}`,
    );
  }

  let fromTime: string | null = null;
  let toTime: string = session.lastEventAt;
  if (commitSha) {
    const win = await commitTimeWindow(worktreePath, commitSha);
    fromTime = win.from;
    toTime = win.to;
  }
  // Compare via epoch ms — git's `%aI` and the JSONL's `timestamp` use
  // different offset conventions (`-03:00` vs `Z`) so string compare is wrong.
  const fromMs = fromTime ? Date.parse(fromTime) : -Infinity;
  const toMs = Date.parse(toTime);

  let task: string | null = null;
  const followUps: string[] = [];
  let todos: TodoItem[] = [];
  const filesTouched: string[] = [];
  const filesSeen = new Set<string>();
  const messages: AgentMessage[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let model: string | null = null;

  for await (const entry of streamJsonl(sessionFilePath)) {
    if (!entry || typeof entry !== "object") continue;
    const ts = typeof entry.timestamp === "string" ? entry.timestamp : null;
    if (!ts) continue;
    const tsMs = Date.parse(ts);
    if (Number.isNaN(tsMs)) continue;
    if (tsMs <= fromMs) continue;
    if (tsMs > toMs) break;
    if (typeof entry.cwd === "string" && entry.cwd !== worktreePath) continue;
    const t = entry.type;
    if (t !== "user" && t !== "assistant" && t !== "system") continue;

    firstTs = firstTs ?? ts;
    lastTs = ts;

    const text = flattenMessageText(entry.message);
    const toolCalls = extractToolCalls(entry.message);
    for (const tc of toolCalls) {
      if (tc.filePath && !filesSeen.has(tc.filePath)) {
        filesSeen.add(tc.filePath);
        filesTouched.push(tc.filePath);
      }
      if (tc.name === "TodoWrite") {
        const next = extractTodos(entry.message);
        if (next) todos = next;
      }
    }

    if (t === "user") {
      if (task === null && text) task = text;
      else if (text && text !== task) followUps.push(text);
    }
    if (t === "assistant") {
      const m = extractModel(entry.message);
      if (m) model = m;
      const usage = extractUsage(entry.message);
      tokensIn += usage.inputTokens;
      tokensOut += usage.outputTokens;
    }

    messages.push({
      uuid: typeof entry.uuid === "string" ? entry.uuid : "",
      role: t,
      timestamp: ts,
      text,
      toolCalls,
    });
  }

  const durationMs =
    firstTs && lastTs
      ? Math.max(0, Date.parse(lastTs) - Date.parse(firstTs))
      : 0;

  return {
    session,
    commitSha,
    fromTime,
    toTime,
    task,
    followUps,
    todos,
    filesTouched,
    messages,
    tokensIn,
    tokensOut,
    durationMs,
    model,
  };
}

/**
 * Inclusive-exclusive time window for a commit on the worktree's HEAD branch.
 * `from` is the prev commit's author date; `to` is this commit's. When the
 * commit is the first on its branch, `from` is null.
 */
async function commitTimeWindow(
  worktreePath: string,
  sha: string,
): Promise<{ from: string | null; to: string }> {
  if (sha.startsWith("-") || !/^[A-Fa-f0-9]{4,64}$/.test(sha)) {
    throw new Error(`invalid commit sha: ${sha}`);
  }
  // %aI = author date strict ISO 8601. We ask for this commit + its parent so
  // we can slice the right window without an extra round-trip.
  const { stdout } = await execFileAsync(
    GIT,
    ["log", "-1", "--format=%H%x09%aI%x09%P", "--end-of-options", sha],
    { cwd: worktreePath },
  );
  const line = stdout.trim().split("\n")[0] ?? "";
  const [, to, parents = ""] = line.split("\t");
  if (!to) throw new Error(`could not resolve commit time for ${sha}`);
  const firstParent = parents.split(" ").filter(Boolean)[0];
  if (!firstParent) return { from: null, to };
  let from: string | null = null;
  try {
    const { stdout: pStdout } = await execFileAsync(
      GIT,
      ["log", "-1", "--format=%aI", "--end-of-options", firstParent],
      { cwd: worktreePath },
    );
    from = pStdout.trim() || null;
  } catch {
    from = null;
  }
  return { from, to };
}

async function* streamJsonl(filePath: string): AsyncIterable<any> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // Skip malformed lines silently. A torn write at the tail of an
      // append-only file is a normal occurrence and shouldn't kill the read.
    }
  }
}

/**
 * Reduce a Claude Code message object to a single human-readable string.
 * Handles: string content, array of parts (`text`, `tool_use`, `tool_result`),
 * and the `role` wrapper. Always returns a string (possibly empty).
 */
function flattenMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { role?: unknown; content?: unknown };
  const content = m.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; text?: unknown };
    if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
    // tool_use / tool_result are surfaced separately via extractToolCalls; we
    // intentionally don't dump their full payloads into the message text.
  }
  return parts.join("\n\n");
}

function extractToolCalls(message: unknown): ToolCallSummary[] {
  if (!message || typeof message !== "object") return [];
  const m = message as { content?: unknown };
  if (!Array.isArray(m.content)) return [];
  const out: ToolCallSummary[] = [];
  for (const part of m.content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; name?: unknown; input?: unknown };
    if (p.type !== "tool_use") continue;
    const name = typeof p.name === "string" ? p.name : "?";
    const filePath = extractFilePath(p.input);
    out.push({ name, filePath, oneLine: oneLineForToolCall(name, p.input, filePath) });
  }
  return out;
}

function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const i = input as Record<string, unknown>;
  // Common Claude Code tool input fields that carry a path.
  for (const key of ["file_path", "path", "filePath", "filename"]) {
    const v = i[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function oneLineForToolCall(
  name: string,
  input: unknown,
  filePath: string | null,
): string {
  if (filePath) return `${name} ${filePath}`;
  // Bash gets a special render so the user sees the command, not the args blob.
  if (name === "Bash" && input && typeof input === "object") {
    const cmd = (input as { command?: unknown }).command;
    if (typeof cmd === "string") {
      const trimmed = cmd.trim().split("\n")[0] ?? "";
      return `Bash: ${trimmed.length > 100 ? trimmed.slice(0, 100) + "…" : trimmed}`;
    }
  }
  return name;
}

function extractTodos(message: unknown): TodoItem[] | null {
  if (!message || typeof message !== "object") return null;
  const m = message as { content?: unknown };
  if (!Array.isArray(m.content)) return null;
  for (const part of m.content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; name?: unknown; input?: unknown };
    if (p.type !== "tool_use" || p.name !== "TodoWrite") continue;
    const input = p.input as { todos?: unknown } | null;
    const arr = input?.todos;
    if (!Array.isArray(arr)) return null;
    const todos: TodoItem[] = [];
    for (const t of arr) {
      if (!t || typeof t !== "object") continue;
      const tt = t as Record<string, unknown>;
      const content = typeof tt.content === "string" ? tt.content : null;
      const status = tt.status;
      if (
        !content ||
        (status !== "pending" && status !== "in_progress" && status !== "completed")
      ) {
        continue;
      }
      const af = typeof tt.activeForm === "string" ? tt.activeForm : undefined;
      todos.push({ content, status, ...(af ? { activeForm: af } : {}) });
    }
    return todos;
  }
  return null;
}

function extractModel(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const m = message as { model?: unknown };
  return typeof m.model === "string" ? m.model : null;
}

function extractUsage(message: unknown): {
  inputTokens: number;
  outputTokens: number;
} {
  if (!message || typeof message !== "object") {
    return { inputTokens: 0, outputTokens: 0 };
  }
  const m = message as { usage?: unknown };
  const u = m.usage;
  if (!u || typeof u !== "object") return { inputTokens: 0, outputTokens: 0 };
  const uu = u as Record<string, unknown>;
  const i = typeof uu.input_tokens === "number" ? uu.input_tokens : 0;
  const o = typeof uu.output_tokens === "number" ? uu.output_tokens : 0;
  return { inputTokens: i, outputTokens: o };
}
