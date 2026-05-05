import { randomUUID } from "node:crypto";

// In-memory per-worktree queue for reviewer→agent comments. Slice (a) of
// docs/plans/push-review-comments.md.
//
// The contract is intentionally narrow:
//   - enqueue(): the reviewer UI calls this when the user hits "Send N
//     comments" or sends a freeform message.
//   - pullAndAck(): the Claude Code hook calls this on every PostToolUse /
//     UserPromptSubmit / SessionStart event. Atomic — a second concurrent
//     caller sees an empty queue (see § Atomicity below).
//   - listDelivered(): the reviewer UI polls this to flip the per-thread
//     pip from "queued" to "delivered" once the hook has consumed.
//
// Storage: a plain module-level Map. No database, no file persistence by
// design — the v1 plan calls this out as a known limitation (server
// restart drops unpulled comments). A SQLite-backed durable queue is on the
// roadmap; we don't introduce a new persistence mechanism for one queue.
//
// Atomicity: Node runs JS on a single event-loop tick, so the read-then-
// clear inside pullAndAck() is effectively atomic against any other handler
// in the same process — two concurrent /api/agent/pull requests cannot
// observe the same pending list. "First wins" is the documented semantics
// (see Open Questions in the plan: cross-session disambiguation).

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
  /** Repo-relative path. Omitted for `freeform`. */
  file?: string;
  /** Single line ("118") or range ("72-79"). Omitted for `freeform`. */
  lines?: string;
  body: string;
  commitSha: string;
  /** ISO timestamp when enqueue() accepted the comment. */
  enqueuedAt: string;
}

export interface DeliveredComment extends Comment {
  /** ISO timestamp when pullAndAck() handed the comment to a hook. */
  deliveredAt: string;
}

export type EnqueueInput = Omit<Comment, "id" | "enqueuedAt">;

interface Bucket {
  pending: Comment[];
  delivered: DeliveredComment[];
}

// Cap on `delivered` history per worktree. Drops oldest first when exceeded.
// 200 is plenty for a single review session (the UI surfaces this as
// "showing last 200" when hit) and bounds memory.
const DELIVERED_CAP = 200;

const buckets = new Map<string, Bucket>();

function bucketFor(worktreePath: string): Bucket {
  let b = buckets.get(worktreePath);
  if (!b) {
    b = { pending: [], delivered: [] };
    buckets.set(worktreePath, b);
  }
  return b;
}

/**
 * Append a batch of comments to the pending queue for `worktreePath`.
 * Assigns an `id` (UUID v4) and `enqueuedAt` to each. Returns the enriched
 * comments — the caller (the UI) stores the ids on its replies so a later
 * `listDelivered()` response can be matched back to the originating thread.
 */
export function enqueue(
  worktreePath: string,
  comments: EnqueueInput[],
): Comment[] {
  const bucket = bucketFor(worktreePath);
  const now = new Date().toISOString();
  const enriched: Comment[] = comments.map((c) => ({
    ...c,
    id: randomUUID(),
    enqueuedAt: now,
  }));
  bucket.pending.push(...enriched);
  return enriched;
}

/**
 * Atomically returns and clears the pending list for `worktreePath`,
 * appending each pulled comment to `delivered` with `deliveredAt = now`.
 * Caps delivered history at DELIVERED_CAP per worktree (drops oldest first).
 *
 * Atomicity is per Node event-loop tick (single-threaded JS) — that's
 * sufficient for a single-process server. Two concurrent callers see
 * "first wins": the second observes an empty array.
 */
export function pullAndAck(worktreePath: string): Comment[] {
  const bucket = bucketFor(worktreePath);
  if (bucket.pending.length === 0) {
    return [];
  }
  const pulled = bucket.pending;
  bucket.pending = [];
  const deliveredAt = new Date().toISOString();
  for (const c of pulled) {
    bucket.delivered.push({ ...c, deliveredAt });
  }
  // Trim oldest from the front if we've exceeded the cap.
  if (bucket.delivered.length > DELIVERED_CAP) {
    bucket.delivered.splice(0, bucket.delivered.length - DELIVERED_CAP);
  }
  return pulled;
}

/**
 * Returns delivered comments for `worktreePath`, newest first. Bounded by
 * DELIVERED_CAP — older entries have been dropped.
 */
export function listDelivered(worktreePath: string): DeliveredComment[] {
  const bucket = buckets.get(worktreePath);
  if (!bucket) return [];
  // Internal storage is append-order (oldest → newest). UI wants newest first.
  return bucket.delivered.slice().reverse();
}

// ---------------------------------------------------------------------------
// Payload formatter
// ---------------------------------------------------------------------------

/**
 * Render a `<reviewer-feedback>` envelope wrapping one `<comment>` per
 * pulled item. Empty array → empty string (so the hook can short-circuit
 * without emitting anything).
 *
 * Sort order:
 *   - Comments with a `file` first, sorted by (file path asc, then by the
 *     lower-bound integer in `lines` asc).
 *   - Freeform comments (no file/lines) at the end, in original (send) order.
 *
 * Body handling:
 *   - Markdown is emitted as-is (no HTML escaping). The model parses raw
 *     text fine; escaping would force the agent to un-escape its way back.
 *   - We do disambiguate a literal `</comment>` inside a body by inserting a
 *     space (`</ comment>`). The envelope is not CDATA, so a closing tag in
 *     the middle of a body could otherwise confuse the model's parsing of
 *     where one `<comment>` ends and the next begins. We also defensively
 *     strip `]]>` since some pre-processors treat the envelope as XML/CDATA.
 *
 * **Drift guard (per § 6 of `docs/plans/push-review-comments-tasks.md`):**
 * this function is byte-for-byte identical to `renderPreviewPayload` in
 * `web/src/sendBatch.ts` — the UI's "what the agent will see" toggle has
 * to render the same string the hook will emit. The contract is pinned by
 * `web/src/sendBatch.test.ts` (sort order, envelope shape, sanitization
 * edge cases). If you change the rules here, mirror them there and update
 * the test fixtures together.
 */
export function formatPayload(commitSha: string, comments: Comment[]): string {
  if (comments.length === 0) return "";

  const sorted = sortForPayload(comments);
  const parts: string[] = [];
  parts.push(`<reviewer-feedback from="shippable" commit="${attr(commitSha)}">`);
  for (const c of sorted) {
    const attrs: string[] = [];
    if (c.file !== undefined) attrs.push(`file="${attr(c.file)}"`);
    if (c.lines !== undefined) attrs.push(`lines="${attr(c.lines)}"`);
    attrs.push(`kind="${attr(c.kind)}"`);
    parts.push(`<comment ${attrs.join(" ")}>`);
    parts.push(sanitizeBody(c.body));
    parts.push(`</comment>`);
  }
  parts.push(`</reviewer-feedback>`);
  return parts.join("\n");
}

/**
 * Stable sort: comments with a file path go first (asc by path, then by
 * line lower-bound), freeform comments go last in original order.
 */
function sortForPayload(comments: Comment[]): Comment[] {
  // Decorate-sort-undecorate to keep the sort stable on input order for ties
  // (Array.prototype.sort is stable in modern V8, but freeform tie-breaking
  // is explicit here either way).
  const decorated = comments.map((c, i) => ({
    c,
    i,
    isFreeform: c.file === undefined && c.lines === undefined,
    fileKey: c.file ?? "",
    lineKey: linesLowerBound(c.lines),
  }));
  decorated.sort((a, b) => {
    if (a.isFreeform !== b.isFreeform) return a.isFreeform ? 1 : -1;
    if (a.isFreeform) return a.i - b.i; // both freeform → original order
    if (a.fileKey !== b.fileKey) return a.fileKey < b.fileKey ? -1 : 1;
    if (a.lineKey !== b.lineKey) return a.lineKey - b.lineKey;
    return a.i - b.i;
  });
  return decorated.map((d) => d.c);
}

/**
 * Parse the lower-bound line number from a `lines` value. "118" → 118;
 * "72-79" → 72; missing/garbage → Infinity (sorts after numeric values).
 */
function linesLowerBound(lines: string | undefined): number {
  if (lines === undefined) return Number.POSITIVE_INFINITY;
  const dash = lines.indexOf("-");
  const head = dash === -1 ? lines : lines.slice(0, dash);
  const n = parseInt(head, 10);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function attr(value: string): string {
  // Minimal attribute escape — these values come from internal types
  // (file paths, line strings, kind enum, commit shas), not user free text.
  // A defense-in-depth quote/ampersand replace is still cheap insurance.
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function sanitizeBody(body: string): string {
  // Insert a space between `</` and `comment>` if the literal closing tag
  // appears inside the body. Case-insensitive — the model will read either.
  // The replacement preserves byte counts close enough that markdown
  // formatting isn't disrupted.
  let out = body.replace(/<\/comment>/gi, "</ comment>");
  // Belt-and-braces against CDATA-aware pre-processors, even though the
  // envelope isn't a CDATA section.
  out = out.replace(/]]>/g, "]]&gt;");
  return out;
}
