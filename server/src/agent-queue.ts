import { randomUUID } from "node:crypto";

// In-memory per-worktree queue for review comments. See
// docs/plans/share-review-comments.md for the design.

export type CommentKind =
  | "line"
  | "block"
  | "reply-to-ai-note"
  | "reply-to-teammate"
  | "reply-to-hunk-summary"
  | "freeform";

export interface Comment {
  id: string;
  kind: CommentKind;
  /** Repo-relative path. Omitted (undefined) for `freeform`. */
  file?: string;
  /**
   * String, not number — `"118"` and `"72-79"` both fit. Omitted for
   * `freeform`.
   */
  lines?: string;
  body: string;
  commitSha: string;
  /** Prior comment id this entry replaces. Null when not an edit. */
  supersedes: string | null;
  /** ISO timestamp stamped at enqueue. */
  enqueuedAt: string;
}

export interface DeliveredComment extends Comment {
  /** ISO timestamp stamped when the comment is moved out of pending. */
  deliveredAt: string;
}

interface QueueEntry {
  pending: Comment[];
  delivered: DeliveredComment[];
}

const DELIVERED_HISTORY_CAP = 200;

const queues = new Map<string, QueueEntry>();

function getOrCreate(worktreePath: string): QueueEntry {
  let entry = queues.get(worktreePath);
  if (!entry) {
    entry = { pending: [], delivered: [] };
    queues.set(worktreePath, entry);
  }
  return entry;
}

export function enqueue(
  worktreePath: string,
  comments: Array<Omit<Comment, "id" | "enqueuedAt">>,
): string[] {
  const entry = getOrCreate(worktreePath);
  const ids: string[] = [];
  for (const c of comments) {
    const id = randomUUID();
    const stamped: Comment = {
      ...c,
      id,
      enqueuedAt: new Date().toISOString(),
    };
    entry.pending.push(stamped);
    ids.push(id);
  }
  return ids;
}

/**
 * Atomic: read pending, resolve supersession, move resolved set to delivered,
 * clear pending, return the resolved comments.
 *
 * Supersession is resolved at pull time (not enqueue time) so a freshly
 * enqueued edit can collapse with its predecessor even when both are still
 * pending — the queue only sees the final state of an edit chain.
 */
export function pullAndAck(worktreePath: string): Comment[] {
  const entry = getOrCreate(worktreePath);
  if (entry.pending.length === 0) return [];

  const resolved = resolveSupersessions(entry.pending);

  const now = new Date().toISOString();
  for (const c of resolved) {
    const delivered: DeliveredComment = { ...c, deliveredAt: now };
    entry.delivered.unshift(delivered);
  }
  if (entry.delivered.length > DELIVERED_HISTORY_CAP) {
    entry.delivered.length = DELIVERED_HISTORY_CAP;
  }
  entry.pending = [];
  return resolved;
}

export function listDelivered(worktreePath: string): DeliveredComment[] {
  const entry = queues.get(worktreePath);
  if (!entry) return [];
  return entry.delivered.slice();
}

export function unenqueue(worktreePath: string, id: string): boolean {
  const entry = queues.get(worktreePath);
  if (!entry) return false;
  const idx = entry.pending.findIndex((c) => c.id === id);
  if (idx < 0) return false;
  entry.pending.splice(idx, 1);
  return true;
}

/** Test-only: clear all queues. */
export function resetForTests(): void {
  queues.clear();
}

function resolveSupersessions(pending: Comment[]): Comment[] {
  // A comment's `supersedes` points at the *immediate* predecessor. To
  // collapse a chain {A → B → C} we drop every pending id that is the target
  // of another pending comment's `supersedes`.
  const supersededIds = new Set<string>();
  for (const c of pending) {
    if (c.supersedes && pending.some((p) => p.id === c.supersedes)) {
      supersededIds.add(c.supersedes);
    }
  }
  return pending.filter((c) => !supersededIds.has(c.id));
}

function lowerLineBound(lines: string | undefined): number {
  if (!lines) return Number.POSITIVE_INFINITY;
  const m = lines.match(/^(\d+)/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

function sortForPayload(comments: Comment[]): Comment[] {
  // File path ascending, then line lower-bound ascending. Freeform comments
  // (no file) sink to the end and order among themselves by `enqueuedAt`
  // ascending — preserves send order for the user's free-form notes.
  return comments.slice().sort((a, b) => {
    const aFree = a.kind === "freeform" || !a.file;
    const bFree = b.kind === "freeform" || !b.file;
    if (aFree && bFree) {
      return a.enqueuedAt.localeCompare(b.enqueuedAt);
    }
    if (aFree) return 1;
    if (bFree) return -1;
    const fileCmp = (a.file ?? "").localeCompare(b.file ?? "");
    if (fileCmp !== 0) return fileCmp;
    return lowerLineBound(a.lines) - lowerLineBound(b.lines);
  });
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeBody(body: string): string {
  // Strip `]]>` so a future CDATA wrapper around the body can't be terminated
  // early by user content. We don't wrap in CDATA today, but the cost is
  // trivial and it future-proofs the format.
  return body.replace(/\]\]>/g, "]]");
}

export function formatPayload(
  commentsList: Comment[],
  commitSha: string,
): string {
  if (commentsList.length === 0) return "";
  const sorted = sortForPayload(commentsList);
  const body = sorted.map(renderComment).join("\n");
  return `<reviewer-feedback from="shippable" commit="${escapeXmlAttr(commitSha)}">\n${body}\n</reviewer-feedback>`;
}

function renderComment(c: Comment): string {
  const attrs: string[] = [];
  if (c.kind !== "freeform" && c.file) {
    attrs.push(`file="${escapeXmlAttr(c.file)}"`);
  }
  if (c.kind !== "freeform" && c.lines) {
    attrs.push(`lines="${escapeXmlAttr(c.lines)}"`);
  }
  attrs.push(`kind="${escapeXmlAttr(c.kind)}"`);
  if (c.supersedes) {
    attrs.push(`supersedes="${escapeXmlAttr(c.supersedes)}"`);
  }
  return `  <comment ${attrs.join(" ")}>${sanitizeBody(c.body)}</comment>`;
}
