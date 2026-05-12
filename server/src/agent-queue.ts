import { randomUUID } from "node:crypto";

// In-memory per-worktree queue for review comments. See
// docs/plans/share-review-comments.md for the design.

export type CommentKind =
  | "line"
  | "block"
  | "reply-to-ai-note"
  | "reply-to-teammate"
  | "reply-to-hunk-summary"
  | "reply-to-agent-comment";

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
  /**
   * Id of the parent `AgentComment` this entry replies to. Required when
   * `kind === "reply-to-agent-comment"`, absent otherwise. Distinct from
   * `supersedes` (which means "replaces a prior version of this comment").
   */
  parentAgentCommentId?: string;
  /** ISO timestamp stamped at enqueue. */
  enqueuedAt: string;
}

export interface DeliveredComment extends Comment {
  /** ISO timestamp stamped when the comment is moved out of pending. */
  deliveredAt: string;
}

export type Outcome = "addressed" | "declined" | "noted";

/**
 * An agent-authored entry. Two shapes, distinguished by which optional
 * field is set:
 *
 *  - `parent` set → a reply threaded under a delivered reviewer comment.
 *    Carries the parent's id and an outcome (addressed/declined/noted).
 *  - `anchor` set → a top-level comment anchored to the diff (file+lines).
 *    No outcome — outcomes only make sense for replies.
 *
 * Exactly one of the two is set; the discriminated union prevents the
 * "both / neither" cases at the type level.
 */
interface AgentCommentBase {
  id: string;
  body: string;
  /** ISO timestamp stamped at post time. */
  postedAt: string;
  /** Optional generic identity surface; reserved for future per-harness label. */
  agentLabel?: string;
}

export type AgentComment =
  | (AgentCommentBase & {
      parent: { commentId: string; outcome: Outcome };
      anchor?: never;
    })
  | (AgentCommentBase & {
      anchor: { file: string; lines: string };
      parent?: never;
    });

interface QueueEntry {
  pending: Comment[];
  delivered: DeliveredComment[];
}

const DELIVERED_HISTORY_CAP = 200;
const AGENT_COMMENT_HISTORY_CAP = 200;

const queues = new Map<string, QueueEntry>();
const agentCommentStore = new Map<string, AgentComment[]>();

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

/**
 * Payload accepted by `postAgentComment`. One of the two shapes — discriminated
 * by which field is present — must be supplied:
 *
 *   - `parent` → reply threaded under a delivered reviewer comment.
 *   - `anchor` → top-level comment anchored to file (+ lines) in the diff.
 */
export type PostAgentCommentPayload =
  | {
      parent: { commentId: string; outcome: Outcome };
      body: string;
      agentLabel?: string;
    }
  | {
      anchor: { file: string; lines: string };
      body: string;
      agentLabel?: string;
    };

export function postAgentComment(
  worktreePath: string,
  payload: PostAgentCommentPayload,
): string {
  const id = randomUUID();
  const postedAt = new Date().toISOString();
  const entry: AgentComment =
    "parent" in payload
      ? {
          id,
          body: payload.body,
          postedAt,
          parent: payload.parent,
          ...(payload.agentLabel !== undefined
            ? { agentLabel: payload.agentLabel }
            : {}),
        }
      : {
          id,
          body: payload.body,
          postedAt,
          anchor: payload.anchor,
          ...(payload.agentLabel !== undefined
            ? { agentLabel: payload.agentLabel }
            : {}),
        };
  let list = agentCommentStore.get(worktreePath);
  if (!list) {
    list = [];
    agentCommentStore.set(worktreePath, list);
  }
  list.push(entry);
  // Bound the per-worktree agent-comment list — a noisy agent in a long-
  // lived process otherwise grows this without limit. Mirrors
  // DELIVERED_HISTORY_CAP on the comment side.
  if (list.length > AGENT_COMMENT_HISTORY_CAP) {
    list.splice(0, list.length - AGENT_COMMENT_HISTORY_CAP);
  }
  return id;
}

export function listAgentComments(worktreePath: string): AgentComment[] {
  const list = agentCommentStore.get(worktreePath);
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

/**
 * Returns true when `id` belongs to a **top-level** (anchor-shaped)
 * `AgentComment` in this worktree's store. Used by the enqueue endpoint
 * to defensively reject reviewer replies (`kind === "reply-to-agent-comment"`)
 * that point at:
 *   (a) an id the agent never actually posted (forged or stale), or
 *   (b) a reply-shaped agent entry (a reply, not a top-level root) —
 *       which can't legitimately be the parent of a reviewer reply.
 *
 * Mirrors `isDeliveredCommentId` for the agent-comment store, narrowed
 * to the anchor-shaped variant.
 */
export function isAgentCommentId(
  worktreePath: string,
  id: string,
): boolean {
  const list = agentCommentStore.get(worktreePath);
  if (!list) return false;
  return list.some((c) => c.id === id && c.anchor !== undefined);
}

/** Test-only: clear all queues. */
export function resetForTests(): void {
  queues.clear();
  agentCommentStore.clear();
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
  // Strip `]]>` so the CDATA wrapper around the body (added by `renderComment`
  // and the `<parent>` child) can't be terminated early by user content.
  // Without CDATA, a body containing `</comment>` or `</parent>` would break
  // out of the envelope and the agent's parser would see fabricated sibling
  // entries — a real prompt-injection vector.
  return body.replace(/\]\]>/g, "]]");
}

/**
 * Resolver passed to `formatPayload`. Returns the agent comment with the
 * given id, or null when it isn't present (e.g., aged out of the cap-200
 * window). When omitted entirely, every `reply-to-agent-comment` entry is
 * treated as having a missing parent — useful for unit tests that don't
 * care about the parent envelope.
 */
export type AgentCommentLookup = (id: string) => AgentComment | null;

export function formatPayload(
  commentsList: Comment[],
  commitSha: string,
  lookupAgentComment?: AgentCommentLookup,
): string {
  if (commentsList.length === 0) return "";
  const sorted = sortForPayload(commentsList);
  const body = sorted
    .map((c) => renderComment(c, lookupAgentComment))
    .join("\n");
  return `<reviewer-feedback from="shippable" commit="${escapeXmlAttr(commitSha)}">\n${body}\n</reviewer-feedback>`;
}

function renderComment(
  c: Comment,
  lookupAgentComment?: AgentCommentLookup,
): string {
  // `id` is first so the agent sees it before the body — needed to call
  // `shippable_post_review_comment`. Pull-and-ack drains the queue, so this
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

  // For reply-to-agent-comment entries, surface the parent id and inline the
  // parent comment's body as a child element so the agent has context for
  // its reply. If the parent is no longer in the store (capped out), emit
  // `parent-missing="true"` so the agent can degrade gracefully.
  let parentChild = "";
  if (c.kind === "reply-to-agent-comment" && c.parentAgentCommentId) {
    attrs.push(`parent-id="${escapeXmlAttr(c.parentAgentCommentId)}"`);
    const parent = lookupAgentComment?.(c.parentAgentCommentId) ?? null;
    if (parent && parent.anchor) {
      const parentAttrs = [
        `id="${escapeXmlAttr(parent.id)}"`,
        `file="${escapeXmlAttr(parent.anchor.file)}"`,
        `lines="${escapeXmlAttr(parent.anchor.lines)}"`,
      ];
      parentChild = `<parent ${parentAttrs.join(" ")}><![CDATA[${sanitizeBody(parent.body)}]]></parent>`;
    } else {
      attrs.push(`parent-missing="true"`);
    }
  }

  // Body is CDATA-wrapped so user-supplied prose can't escape the
  // surrounding <comment> / <parent> elements. `sanitizeBody` strips any
  // `]]>` sequence so the wrapper itself can't be terminated early.
  return `  <comment ${attrs.join(" ")}><![CDATA[${sanitizeBody(c.body)}]]>${parentChild}</comment>`;
}
