export type LineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldNo?: number;
  newNo?: number;
  aiNote?: AiNote;
}

export type AiNoteSeverity = "info" | "question" | "warning";

export interface AiNote {
  severity: AiNoteSeverity;
  summary: string;
  detail?: string;
  /**
   * Optional one-click verifier for the claim above. When present, the
   * inspector renders a `▷ verify` button on the note that opens the
   * runner with `source` already loaded and the `inputs` slot map
   * pre-filled. Lang is inferred from the enclosing file. The recipe
   * needs to be self-contained — the runner sandbox can't see other
   * files in the diff, so any helpers the snippet calls must live in
   * the source string.
   */
  runRecipe?: {
    source: string;
    inputs: Record<string, string>;
  };
}

export interface Hunk {
  id: string;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
  definesSymbols?: string[];
  referencesSymbols?: string[];
  aiReviewed?: boolean;
  aiSummary?: string;
  teammateReview?: {
    user: string;
    verdict: "approve" | "comment";
    note?: string;
  };
  /**
   * Ordered from nearest to farthest: the first element is the block
   * immediately enclosing the hunk; each subsequent element is one
   * scope further out (nearest enclosing function → module scope →
   * file top, for example).
   */
  expandAbove?: DiffLine[][];
  expandBelow?: DiffLine[][];
}

export type FileStatus = "modified" | "added" | "deleted" | "renamed";

export interface DiffFile {
  id: string;
  path: string;
  language: string;
  status: FileStatus;
  hunks: Hunk[];
  /** Full file contents for the "expand entire file" view. */
  fullContent?: DiffLine[];
  /**
   * Post-change file content as a single string. The markdown preview uses
   * this to render the file as it'll look once merged. Backed by the
   * `fileContents` map the worktree-changeset endpoint returns; fixtures
   * with `fullContent` already contain the same data, so this is mainly a
   * carrier for diffs we can't reconstruct from hunks alone.
   */
  postChangeText?: string;
}

export interface CodeGraphNode {
  path: string;
  isTest: boolean;
}

export interface CodeGraphEdge {
  fromPath: string;
  toPath: string;
  labels: string[];
  kind: "import" | "symbol";
}

export interface CodeGraph {
  scope: "diff" | "repo";
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
}

export interface ChangeSet {
  id: string;
  title: string;
  author: string;
  branch: string;
  base: string;
  createdAt: string;
  description: string;
  files: DiffFile[];
  /**
   * Repo-relative path → URL (typically a data URL) for binary assets that
   * the markdown preview should resolve. Keys must match the path computed
   * from a markdown file's directory plus its relative image reference.
   */
  imageAssets?: Record<string, string>;
  /**
   * Optional dependency graph attached by the ingest path. Pasted/uploaded
   * diffs can derive a diff-scoped graph from changed hunks; worktree-backed
   * loads may attach a repo-scoped graph built from the checkout on disk.
   */
  graph?: CodeGraph;
  /**
   * Set when this ChangeSet was loaded from a local worktree — carries the
   * path + sha so the agent-context panel knows what to fetch. Travelling
   * with the ChangeSet (rather than as separate App state) means the
   * provenance survives page reloads and changeset switches.
   */
  worktreeSource?: WorktreeSource;
}

export interface Cursor {
  changesetId: string;
  fileId: string;
  hunkId: string;
  lineIdx: number;
}

export interface Reply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  /**
   * Server-assigned id once the reply has been enqueued for the agent. `null`
   * after a failed enqueue (the parent surfaces a "Save again" affordance);
   * absent on legacy fixture/persisted replies that pre-date the queue —
   * those rehydrate to `null` via the persist-layer migration.
   */
  enqueuedCommentId?: string | null;
  /**
   * `true` when the most recent enqueue attempt for this Reply errored. Drives
   * the ⚠ errored pip + click-to-retry affordance in `ReplyThread`. Cleared
   * on a successful retry. Absent / `false` means "no error, no retry needed".
   * Always coexists with `enqueuedCommentId === null` — once an id lands the
   * delivered pip wins regardless of any stale error flag.
   */
  enqueueError?: boolean;
  /**
   * Agent replies threaded under this reviewer Reply. Match key is the
   * server's wire `commentId` ↔ `enqueuedCommentId` here. Append-only on
   * the server; idempotent reconcile on the client (existing ids update in
   * place, new ids append, sorted by `postedAt` ascending). Optional
   * because it's absent on legacy fixture/persisted replies that pre-date
   * the field — those rehydrate to `[]` via the persist-layer migration.
   */
  agentReplies?: AgentReply[];
  /**
   * Worktree HEAD at write time (or the loaded ChangeSet id for non-worktree
   * loads). The Sidebar's "Detached" section displays the short prefix on a
   * "view at <sha7>" affordance for committed entries.
   */
  originSha?: string;
  /**
   * Whether this reply was authored against a committed view of the file or
   * the working-tree state. Drives the caption shown on detached entries.
   * Absent on legacy replies that pre-date anchored comments — they render
   * as `committed` by default.
   */
  originType?: "committed" | "dirty";
  /** Repo-relative file path the reply was anchored to at write time. */
  anchorPath?: string;
  /**
   * Up to 10 lines centered on the anchor (5 above, anchor, 4 below). Wide
   * enough to make the detached snippet self-explanatory; trimmed at the
   * edges of the hunk. Display only — never used for matching.
   */
  anchorContext?: DiffLine[];
  /**
   * Hash of the inner 5 lines (anchor ± 2). Used by the reload pass to find
   * the same code in the new diff. See `anchor.ts`.
   */
  anchorHash?: string;
}

/**
 * An agent's structured reply to a reviewer comment. See
 * `docs/sdd/agent-reply-support/spec.md` for the design.
 */
export interface AgentReply {
  id: string;
  body: string;
  outcome: "addressed" | "declined" | "noted";
  /** ISO timestamp stamped at post time. */
  postedAt: string;
  /** Optional generic identity surface; reserved for future per-harness label. */
  agentLabel?: string;
}

/**
 * A reply whose anchor no longer matches anywhere in the new diff. Carries
 * its original key so the persisted shape round-trips cleanly; `reply` is
 * unchanged from when it was authored — the `anchorContext` snippet on it
 * is what the Sidebar renders.
 */
export interface DetachedReply {
  reply: Reply;
  /** The reply key (note:/user:/block:/etc.) the reply was attached to. */
  threadKey: string;
}

/**
 * A contiguous line range within a single hunk, produced by shift-extending
 * the cursor. `anchor` is where the selection started; `head` is its current
 * end (kept in sync with `cursor.lineIdx`). The effective range is
 * min(anchor, head)..max(anchor, head) inclusive. Selection collapses to null
 * on any non-extending move, hunk/file change, or Escape.
 */
export interface LineSelection {
  hunkId: string;
  anchor: number;
  head: number;
}

export interface ReviewState {
  cursor: Cursor;
  changesets: ChangeSet[];
  /**
   * Lines the cursor has visited, by hunk id. Auto-populated on every
   * cursor move. Renders as a dim gutter rail. Coverage from this map
   * is the "read" signal — informational, not a verdict.
   */
  readLines: Record<string, Set<number>>;
  /**
   * File ids the reviewer has explicitly signed off on, via Shift+M.
   * The single verdict gesture. Toggle: pressing again clears the file.
   */
  reviewedFiles: Set<string>;
  dismissedGuides: Set<string>;
  /** keys are `${hunkId}:${lineIdx}` */
  ackedNotes: Set<string>;
  /** keys are reply-target keys; see replyKey helpers */
  replies: Record<string, Reply[]>;
  /** Per-hunk count of blocks revealed above; 0 = nothing extra. */
  expandLevelAbove: Record<string, number>;
  expandLevelBelow: Record<string, number>;
  fullExpandedFiles: Set<string>;
  /**
   * File ids the reviewer has switched into rendered-preview mode (markdown
   * files only). Mutually exclusive with `fullExpandedFiles`.
   */
  previewedFiles: Set<string>;
  /** Active shift-extended selection; null when the cursor is a single line. */
  selection: LineSelection | null;
  /**
   * Replies whose anchor didn't match anywhere in the latest reload of their
   * changeset. Per `docs/plans/worktree-live-reload.md`, the Sidebar surfaces
   * these in a "Detached" group so the thread is still visible even though
   * the line it was attached to is gone.
   */
  detachedReplies: DetachedReply[];
}

// ── Review plan (the "where to begin" primitive) ──────────────────────────
// Every surface that makes a claim about the ChangeSet must carry evidence
// back to the diff. EvidenceRef is the pointer; Claim bundles text + refs.
// UI must refuse to render a claim whose `evidence` array is empty.

export type EvidenceRef =
  | { kind: "description" }
  | { kind: "file"; path: string }
  | { kind: "hunk"; hunkId: string }
  | { kind: "symbol"; name: string; definedIn: string };

export interface Claim {
  text: string;
  evidence: EvidenceRef[];
}

export interface StructureMapFile {
  fileId: string;
  path: string;
  status: FileStatus;
  added: number;
  removed: number;
  isTest: boolean;
}

export interface StructureMapSymbol {
  name: string;
  /** File path where the symbol is defined. */
  definedIn: string;
  /** File paths (within this ChangeSet) that reference it. */
  referencedIn: string[];
}

export interface StructureMap {
  files: StructureMapFile[];
  symbols: StructureMapSymbol[];
}

export interface EntryPoint {
  fileId: string;
  hunkId?: string;
  reason: Claim;
}

export interface ReviewPlan {
  /** Verbatim from ChangeSet.title. */
  headline: string;
  /** Rule-based or AI-generated; each claim carries evidence. */
  intent: Claim[];
  map: StructureMap;
  /** Max 3; may be fewer if the diff doesn't warrant more. */
  entryPoints: EntryPoint[];
}

// ── Agent context (Claude Code session matched to a worktree) ────────────
// These mirror the server-side shapes in `server/src/agent-context.ts`. See
// `docs/concepts/agent-context.md` for the wider design.

export interface AgentSessionRef {
  sessionId: string;
  filePath: string;
  startedAt: string;
  lastEventAt: string;
  taskTitle: string | null;
  turnCount: number;
  cwds: string[];
}

export interface AgentToolCallSummary {
  name: string;
  filePath: string | null;
  oneLine: string;
}

export interface AgentMessage {
  uuid: string;
  role: "user" | "assistant" | "system";
  timestamp: string;
  text: string;
  toolCalls: AgentToolCallSummary[];
}

export interface AgentTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface AgentContextSlice {
  session: AgentSessionRef;
  commitSha: string | null;
  fromTime: string | null;
  toTime: string;
  task: string | null;
  followUps: string[];
  todos: AgentTodoItem[];
  filesTouched: string[];
  messages: AgentMessage[];
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  model: string | null;
}

/**
 * Worktree probe for the live-reload poll. `sha` is the real HEAD sha;
 * `dirtyHash` is null on a clean tree and a digest of `git status --porcelain=v2`
 * otherwise. The pair (sha, dirtyHash) is the comparison key — any change in
 * either signals drift.
 */
export interface WorktreeState {
  sha: string;
  dirty: boolean;
  dirtyHash: string | null;
}

/**
 * Worktree provenance carried alongside a ChangeSet so the agent-context panel
 * knows what to fetch. Set when the changeset was loaded from a worktree;
 * null otherwise (URL ingest, paste, file upload).
 *
 * `state` is the worktree's observed (sha, dirty, dirtyHash) at load time.
 * The live-reload poll diffs against this baseline; null on legacy persisted
 * recents written before the field existed.
 */
export interface WorktreeSource {
  worktreePath: string;
  commitSha: string;
  branch: string | null;
  /**
   * True when the loaded view is `HEAD..working-tree` (uncommitted edits)
   * instead of `HEAD~1..HEAD`. Set by slice (a) of the live-reload plan;
   * comments authored against this view are tagged `originType: "dirty"`.
   * Absent / false means a normal committed view.
   */
  dirty?: boolean;
  state?: WorktreeState;
}

/**
 * Polling-baseline shape passed into the live-reload hook + banner. Derived
 * from the active ChangeSet's `worktreeSource`; null when no worktree is
 * loaded or when state wasn't captured (legacy data).
 */
export interface WorktreeProvenance {
  path: string;
  branch: string | null;
  state: WorktreeState;
}

export function noteKey(hunkId: string, lineIdx: number): string {
  return `${hunkId}:${lineIdx}`;
}
export function lineNoteReplyKey(hunkId: string, lineIdx: number): string {
  return `note:${hunkId}:${lineIdx}`;
}
export function hunkSummaryReplyKey(hunkId: string): string {
  return `hunkSummary:${hunkId}`;
}
export function teammateReplyKey(hunkId: string): string {
  return `teammate:${hunkId}`;
}
/** Fresh user-started comment on a line (not a reply to AI/teammate). */
export function userCommentKey(hunkId: string, lineIdx: number): string {
  return `user:${hunkId}:${lineIdx}`;
}
/**
 * Reply-key for a user-started comment on a line range. `lo` and `hi` are
 * inclusive; callers must pass them pre-sorted (lo <= hi) so a key uniquely
 * identifies its range.
 */
export function blockCommentKey(hunkId: string, lo: number, hi: number): string {
  return `block:${hunkId}:${lo}-${hi}`;
}

// ── Agent comment queue (mirror of server/src/agent-queue.ts) ────────────
// These shapes travel verbatim across the `/api/agent/*` endpoints. Keep in
// sync with the server-side definitions; they're the wire format for the
// pull channel described in docs/plans/share-review-comments.md.

export type CommentKind =
  | "line"
  | "block"
  | "reply-to-ai-note"
  | "reply-to-teammate"
  | "reply-to-hunk-summary";

export interface Comment {
  id: string;
  kind: CommentKind;
  /** Repo-relative path. */
  file: string;
  /** `"118"` or `"72-79"` — string so single lines and ranges both fit. */
  lines?: string;
  body: string;
  commitSha: string;
  /** Prior comment id this entry replaces. `null` when not an edit. */
  supersedes: string | null;
  /** ISO timestamp stamped at enqueue. */
  enqueuedAt: string;
}

export interface DeliveredComment extends Comment {
  /** ISO timestamp stamped when the comment was moved out of pending. */
  deliveredAt: string;
}
