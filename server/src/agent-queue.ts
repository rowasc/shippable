import { randomUUID } from "node:crypto";

// In-memory per-worktree queue for review comments. See
// docs/plans/share-review-comments.md for the design.

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
  /** String, not number — `"118"` and `"72-79"` both fit. */
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

export type Outcome = "addressed" | "declined" | "noted";

export interface AgentReply {
  id: string;
  /** The delivered comment id this reply answers. */
  commentId: string;
  body: string;
  outcome: Outcome;
  /** ISO timestamp stamped at post time. */
  postedAt: string;
  /** Optional generic identity surface; reserved for future per-harness label. */
  agentLabel?: string;
}

interface QueueEntry {
  pending: Comment[];
  delivered: DeliveredComment[];
}

const DELIVERED_HISTORY_CAP = 200;
const REPLY_HISTORY_CAP = 200;

const queues = new Map<string, QueueEntry>();
const replyStore = new Map<string, AgentReply[]>();

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

export function postReply(
  worktreePath: string,
  payload: { commentId: string; body: string; outcome: Outcome; agentLabel?: string },
): string {
  const id = randomUUID();
  const reply: AgentReply = {
    id,
    commentId: payload.commentId,
    body: payload.body,
    outcome: payload.outcome,
    postedAt: new Date().toISOString(),
  };
  if (payload.agentLabel !== undefined) reply.agentLabel = payload.agentLabel;
  let list = replyStore.get(worktreePath);
  if (!list) {
    list = [];
    replyStore.set(worktreePath, list);
  }
  list.push(reply);
  // Bound the per-worktree reply list — a noisy agent in a long-lived
  // process otherwise grows this without limit. Mirrors
  // DELIVERED_HISTORY_CAP on the comment side.
  if (list.length > REPLY_HISTORY_CAP) {
    list.splice(0, list.length - REPLY_HISTORY_CAP);
  }
  return id;
}

export function listReplies(worktreePath: string): AgentReply[] {
  const list = replyStore.get(worktreePath);
  if (!list) return [];
  return list.slice();
}

/**
 * Returns true when `commentId` was previously delivered for this worktree.
 * Used by the reply endpoint to defensively reject replies anchored to ids
 * the agent never actually saw.
 */
export function isDeliveredCommentId(
  worktreePath: string,
  commentId: string,
): boolean {
  const entry = queues.get(worktreePath);
  if (!entry) return false;
  return entry.delivered.some((d) => d.id === commentId);
}

/** Test-only: clear all queues. */
export function resetForTests(): void {
  queues.clear();
  replyStore.clear();
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
  // File path ascending, then line lower-bound ascending.
  return comments.slice().sort((a, b) => {
    const fileCmp = a.file.localeCompare(b.file);
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
  // `id` is first so the agent sees it before the body — needed to call
  // `shippable_post_review_reply`. Pull-and-ack drains the queue, so this
  // is the only chance the agent has to read the id.
  const attrs: string[] = [
    `id="${escapeXmlAttr(c.id)}"`,
    `file="${escapeXmlAttr(c.file)}"`,
  ];
  if (c.lines) {
    attrs.push(`lines="${escapeXmlAttr(c.lines)}"`);
  }
  attrs.push(`kind="${escapeXmlAttr(c.kind)}"`);
  if (c.supersedes) {
    attrs.push(`supersedes="${escapeXmlAttr(c.supersedes)}"`);
  }
  return `  <comment ${attrs.join(" ")}>${sanitizeBody(c.body)}</comment>`;
}
