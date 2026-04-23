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

export interface Skill {
  id: string;
  label: string;
  reason: string;
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
  skills: Skill[];
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

export interface ReviewState {
  cursor: Cursor;
  changesets: ChangeSet[];
  reviewedLines: Record<string, Set<number>>;
  dismissedGuides: Set<string>;
  activeSkills: Set<string>;
  /** keys are `${hunkId}:${lineIdx}` */
  ackedNotes: Set<string>;
  /** keys are reply-target keys; see replyKey helpers */
  replies: Record<string, Reply[]>;
  /** Per-hunk count of blocks revealed above; 0 = nothing extra. */
  expandLevelAbove: Record<string, number>;
  expandLevelBelow: Record<string, number>;
  fullExpandedFiles: Set<string>;
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
