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
  /** Active shift-extended selection; null when the cursor is a single line. */
  selection: LineSelection | null;
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
