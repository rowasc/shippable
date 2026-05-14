import { randomUUID } from "node:crypto";

// In-memory per-worktree queue for review interactions. See
// docs/plans/share-review-comments.md and docs/plans/typed-review-interactions.md
// for the design. The wire envelope is `<interaction>`; the stored shape
// mirrors `web/src/types.ts#Interaction` minus the fields the wire doesn't
// need (anchor*, runRecipe, queue bookkeeping).

export type InteractionTarget = "line" | "block" | "reply";

export type AskIntent = "comment" | "question" | "request" | "blocker";
export type ResponseIntent = "ack" | "unack" | "accept" | "reject";
export type InteractionIntent = AskIntent | ResponseIntent;

export type InteractionAuthorRole = "user" | "ai" | "agent";

export function isAskIntent(i: InteractionIntent): i is AskIntent {
  return i === "comment" || i === "question" || i === "request" || i === "blocker";
}

/**
 * Validity rule (mirrors `web/src/types.ts#isValidInteractionPair`): response
 * intents only ever attach to other interactions — every `reply-to-*` target.
 * Asks attach to code (`line`/`block`) or to other interactions. The web
 * reducer and composer enforce this too; this is the third belt-and-braces
 * seam called out in docs/plans/typed-review-interactions.md (§158-162).
 */
export function isValidInteractionPair(
  target: InteractionTarget,
  intent: InteractionIntent,
): boolean {
  if (target === "line" || target === "block") return isAskIntent(intent);
  return true;
}

export interface Interaction {
  id: string;
  target: InteractionTarget;
  intent: InteractionIntent;
  author: string;
  authorRole: InteractionAuthorRole;
  /** Repo-relative path. */
  file: string;
  /** String, not number — `"118"` and `"72-79"` both fit. */
  lines?: string;
  body: string;
  commitSha: string;
  /** Prior interaction id this entry replaces. Null when not an edit. */
  supersedes: string | null;
  /** ISO timestamp stamped at enqueue. */
  enqueuedAt: string;
  /** Optional provenance link back to GitHub for PR-imported interactions. */
  htmlUrl?: string;
}

export interface DeliveredInteraction extends Interaction {
  /** ISO timestamp stamped when the interaction is moved out of pending. */
  deliveredAt: string;
}

/** Server-side outcome alias for the typed response intents accepted on
 *  the reply endpoint. Kept as a Response-intent subset for now — `unack`
 *  is a local toggle, not something an agent posts back. */
export type AgentResponseIntent = Exclude<ResponseIntent, "unack">;

/**
 * An agent's post-back to the review server. One shape covers both modes:
 *   - reply (`parentId` set) — a response to a delivered reviewer
 *     interaction. Intent is constrained to the response-intent subset
 *     (ack / accept / reject).
 *   - top-level (`file` + `lines` + `target` set) — a fresh thread the
 *     agent started on its own. Intent is one of the ask intents.
 */
export type AgentReply =
  | {
      id: string;
      parentId: string;
      body: string;
      intent: AgentResponseIntent;
      postedAt: string;
      agentLabel?: string;
    }
  | {
      id: string;
      file: string;
      lines: string;
      target: "line" | "block";
      body: string;
      intent: AskIntent;
      postedAt: string;
      agentLabel?: string;
    };

interface QueueEntry {
  pending: Interaction[];
  delivered: DeliveredInteraction[];
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
  interactions: Array<Omit<Interaction, "id" | "enqueuedAt">>,
): string[] {
  const entry = getOrCreate(worktreePath);
  const ids: string[] = [];
  for (const ix of interactions) {
    const id = randomUUID();
    const stamped: Interaction = {
      ...ix,
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
 * clear pending, return the resolved interactions.
 *
 * Supersession is resolved at pull time (not enqueue time) so a freshly
 * enqueued edit can collapse with its predecessor even when both are still
 * pending — the queue only sees the final state of an edit chain.
 */
export function pullAndAck(worktreePath: string): Interaction[] {
  const entry = getOrCreate(worktreePath);
  if (entry.pending.length === 0) return [];

  const resolved = resolveSupersessions(entry.pending);

  const now = new Date().toISOString();
  for (const ix of resolved) {
    const delivered: DeliveredInteraction = { ...ix, deliveredAt: now };
    entry.delivered.unshift(delivered);
  }
  if (entry.delivered.length > DELIVERED_HISTORY_CAP) {
    entry.delivered.length = DELIVERED_HISTORY_CAP;
  }
  entry.pending = [];
  return resolved;
}

export function listDelivered(worktreePath: string): DeliveredInteraction[] {
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
 * Post a reply-shaped agent entry (responds to a delivered reviewer
 * interaction). Caller already validated the parentId exists in the
 * delivered set.
 */
export function postReply(
  worktreePath: string,
  payload: {
    parentId: string;
    body: string;
    intent: AgentResponseIntent;
    agentLabel?: string;
  },
): string {
  const id = randomUUID();
  const reply: AgentReply = {
    id,
    parentId: payload.parentId,
    body: payload.body,
    intent: payload.intent,
    postedAt: new Date().toISOString(),
    ...(payload.agentLabel !== undefined
      ? { agentLabel: payload.agentLabel }
      : {}),
  };
  appendReply(worktreePath, reply);
  return id;
}

/**
 * Post a top-level agent-started entry — a fresh thread anchored to
 * (file, lines). Intent must be an ask; target distinguishes single-line
 * from block.
 */
export function postTopLevel(
  worktreePath: string,
  payload: {
    file: string;
    lines: string;
    target: "line" | "block";
    body: string;
    intent: AskIntent;
    agentLabel?: string;
  },
): string {
  const id = randomUUID();
  const reply: AgentReply = {
    id,
    file: payload.file,
    lines: payload.lines,
    target: payload.target,
    body: payload.body,
    intent: payload.intent,
    postedAt: new Date().toISOString(),
    ...(payload.agentLabel !== undefined
      ? { agentLabel: payload.agentLabel }
      : {}),
  };
  appendReply(worktreePath, reply);
  return id;
}

function appendReply(worktreePath: string, reply: AgentReply): void {
  let list = replyStore.get(worktreePath);
  if (!list) {
    list = [];
    replyStore.set(worktreePath, list);
  }
  list.push(reply);
  // Bound the per-worktree reply list — a noisy agent in a long-lived
  // process otherwise grows this without limit.
  if (list.length > REPLY_HISTORY_CAP) {
    list.splice(0, list.length - REPLY_HISTORY_CAP);
  }
}

/**
 * Wire shape returned by GET /api/agent/replies — one envelope covers
 * both reply-shaped (parentId set) and top-level-shaped (file + lines
 * set) entries. The web client merges either into state.interactions.
 */
export type AgentReplyWireItem =
  | {
      id: string;
      parentId: string;
      body: string;
      intent: AgentResponseIntent;
      author: string;
      authorRole: "agent";
      target: InteractionTarget;
      postedAt: string;
    }
  | {
      id: string;
      file: string;
      lines: string;
      body: string;
      intent: AskIntent;
      author: string;
      authorRole: "agent";
      target: "line" | "block";
      postedAt: string;
    };

export function listReplies(worktreePath: string): AgentReplyWireItem[] {
  const list = replyStore.get(worktreePath);
  if (!list) return [];
  return list.map((r): AgentReplyWireItem => {
    if ("parentId" in r) {
      return {
        id: r.id,
        parentId: r.parentId,
        body: r.body,
        intent: r.intent,
        author: r.agentLabel ?? "agent",
        authorRole: "agent",
        target: "reply",
        postedAt: r.postedAt,
      };
    }
    return {
      id: r.id,
      file: r.file,
      lines: r.lines,
      body: r.body,
      intent: r.intent,
      author: r.agentLabel ?? "agent",
      authorRole: "agent",
      target: r.target,
      postedAt: r.postedAt,
    };
  });
}

/**
 * Returns true when `id` was previously delivered for this worktree.
 * Used by the reply endpoint to defensively reject replies anchored to ids
 * the agent never actually saw.
 */
export function isDeliveredInteractionId(
  worktreePath: string,
  id: string,
): boolean {
  const entry = queues.get(worktreePath);
  if (!entry) return false;
  return entry.delivered.some((d) => d.id === id);
}

/** Test-only: clear all queues. */
export function resetForTests(): void {
  queues.clear();
  replyStore.clear();
}

function resolveSupersessions(pending: Interaction[]): Interaction[] {
  // A pending entry's `supersedes` points at the *immediate* predecessor. To
  // collapse a chain {A → B → C} we drop every pending id that is the target
  // of another pending entry's `supersedes`.
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

function sortForPayload(items: Interaction[]): Interaction[] {
  // File path ascending, then line lower-bound ascending.
  return items.slice().sort((a, b) => {
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
  // Strip `]]>` so the CDATA wrapper can't be terminated early by user content.
  return body.replace(/\]\]>/g, "]]");
}

export function formatPayload(
  items: Interaction[],
  commitSha: string,
): string {
  if (items.length === 0) return "";
  const sorted = sortForPayload(items);
  const body = sorted.map(renderInteraction).join("\n");
  return `<reviewer-feedback from="shippable" commit="${escapeXmlAttr(commitSha)}">\n${body}\n</reviewer-feedback>`;
}

function renderInteraction(c: Interaction): string {
  // `id` is first so the agent sees it before the body — needed to call
  // `shippable_post_review_comment`. Pull-and-ack drains the queue, so this
  // is the only chance the agent has to read the id.
  const attrs: string[] = [
    `id="${escapeXmlAttr(c.id)}"`,
    `target="${escapeXmlAttr(c.target)}"`,
    `intent="${escapeXmlAttr(c.intent)}"`,
    `author="${escapeXmlAttr(c.author)}"`,
    `authorRole="${escapeXmlAttr(c.authorRole)}"`,
    `file="${escapeXmlAttr(c.file)}"`,
  ];
  if (c.lines) {
    attrs.push(`lines="${escapeXmlAttr(c.lines)}"`);
  }
  if (c.htmlUrl) {
    attrs.push(`htmlUrl="${escapeXmlAttr(c.htmlUrl)}"`);
  }
  if (c.supersedes) {
    attrs.push(`supersedes="${escapeXmlAttr(c.supersedes)}"`);
  }
  // Wrap body in CDATA so a reviewer can't break out of the <interaction>
  // element by pasting `</interaction>` into their comment.
  return `  <interaction ${attrs.join(" ")}><![CDATA[${sanitizeBody(c.body)}]]></interaction>`;
}
