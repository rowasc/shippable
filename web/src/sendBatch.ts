/**
 * Helpers for the Send-batch flow in the agent-context panel: scan the
 * current `ReviewState.replies` for unsent reviewer-authored replies and
 * pair each with the `DraftComment` payload the server expects.
 *
 * Design notes:
 *
 * - The collector only runs over keys whose `hunkId` is present in the
 *   active changeset. Reply state is keyed across all loaded changesets,
 *   so a switch to a fixture wouldn't drag in unsent replies from a
 *   worktree the user isn't viewing.
 *
 * - The reviewer's display name today is the constant "you" (see
 *   `App.tsx`'s onSubmitReply, where every authored reply is stamped
 *   `author: "you"`). We filter on that here. If a profile system lands
 *   later this becomes a parameter.
 *
 * - Only line-numbered hunks resolve cleanly into `lines` strings. Lines
 *   without a `newNo`/`oldNo` (rare, but possible for synthetic lines)
 *   skip silently — the Send button doesn't break.
 *
 * - Sort order is intentionally NOT enforced here. The server formatter
 *   re-sorts on `(file path, line lower-bound)` with freeform last; the
 *   spec says preview rows are non-reorderable, so the order we return
 *   is the order the preview sheet renders. The "what the agent will
 *   see" toggle uses the same client-side sort as the server formatter.
 */

import type {
  ChangeSet,
  DraftComment,
  Hunk,
  Reply,
  ReviewState,
} from "./types";
import { decodeReplyKey } from "./types";

export interface UnsentEntry {
  /** The reply-key under which the entry lives in `ReviewState.replies`. */
  key: string;
  /** The specific Reply object (from the thread) that's unsent. */
  reply: Reply;
  /** Wire shape — ready to ship to `/api/agent/enqueue`. */
  comment: DraftComment;
}

/** The reviewer's display name. See module-level note. */
export const REVIEWER_AUTHOR = "you";

/**
 * Walk every reply thread in `state.replies`, decode each key, resolve the
 * file/line via the active changeset, and emit one entry per
 * reviewer-authored reply that hasn't been sent yet.
 *
 * Threads keyed against hunks not in this changeset are skipped — this is
 * the user-friendly behaviour for changeset switches: the Send-batch
 * button only acts on what's visible.
 */
export function collectUnsent(
  state: ReviewState,
  changeset: ChangeSet,
): UnsentEntry[] {
  const hunkIndex = buildHunkIndex(changeset);
  const out: UnsentEntry[] = [];
  for (const [key, replies] of Object.entries(state.replies)) {
    if (!replies || replies.length === 0) continue;
    const decoded = decodeReplyKey(key);
    if (!decoded) continue;
    const hunkLoc = hunkIndex.get(decoded.hunkId);
    if (!hunkLoc) continue; // hunk not in the active changeset
    for (const reply of replies) {
      if (reply.author !== REVIEWER_AUTHOR) continue;
      // `sentToAgentAt` is optional for backwards compat with older
      // persisted snapshots / fixtures. null AND undefined both mean
      // "unsent."
      if (reply.sentToAgentAt) continue;
      const comment = buildDraftComment(decoded, hunkLoc, reply.body);
      if (!comment) continue;
      out.push({ key, reply, comment });
    }
  }
  return out;
}

/**
 * Render a list of `DraftComment`s the way the server formatter will:
 * file-keyed comments first, sorted by (file asc, line lower-bound asc),
 * then freeform in the order they appear in the input. The output is the
 * exact `<reviewer-feedback>` string the hook would emit when these
 * comments get pulled — modulo the comment ids and timestamps the server
 * assigns at enqueue time, which don't appear in the envelope.
 *
 * Used for the "what the agent will see" preview toggle. The sort and
 * sanitization rules mirror `server/src/agent-queue.ts` so the preview
 * doesn't drift from reality.
 */
export function renderPreviewPayload(
  commitSha: string,
  comments: DraftComment[],
): string {
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

// ── internals ──────────────────────────────────────────────────────────────

interface HunkLocation {
  hunk: Hunk;
  filePath: string;
}

function buildHunkIndex(changeset: ChangeSet): Map<string, HunkLocation> {
  const out = new Map<string, HunkLocation>();
  for (const f of changeset.files) {
    for (const h of f.hunks) out.set(h.id, { hunk: h, filePath: f.path });
  }
  return out;
}

function buildDraftComment(
  decoded: ReturnType<typeof decodeReplyKey>,
  loc: HunkLocation,
  body: string,
): DraftComment | null {
  if (!decoded) return null;
  const file = loc.filePath;
  switch (decoded.kind) {
    case "note": {
      const lineStr = lineStringFor(loc, decoded.lineIdx);
      if (lineStr === null) return null;
      return { kind: "reply-to-ai-note", file, lines: lineStr, body };
    }
    case "user": {
      const lineStr = lineStringFor(loc, decoded.lineIdx);
      if (lineStr === null) return null;
      return { kind: "line", file, lines: lineStr, body };
    }
    case "block": {
      const lo = lineNumberFor(loc, decoded.lo);
      const hi = lineNumberFor(loc, decoded.hi);
      if (lo === null || hi === null) return null;
      return { kind: "block", file, lines: `${lo}-${hi}`, body };
    }
    case "hunkSummary": {
      const lineStr = topOfHunk(loc);
      if (lineStr === null) return null;
      return { kind: "reply-to-hunk-summary", file, lines: lineStr, body };
    }
    case "teammate": {
      const lineStr = topOfHunk(loc);
      if (lineStr === null) return null;
      return { kind: "reply-to-teammate", file, lines: lineStr, body };
    }
  }
}

function lineNumberFor(loc: HunkLocation, lineIdx: number): number | null {
  const line = loc.hunk.lines[lineIdx];
  if (!line) return null;
  const n = line.newNo ?? line.oldNo;
  return typeof n === "number" ? n : null;
}

function lineStringFor(loc: HunkLocation, lineIdx: number): string | null {
  const n = lineNumberFor(loc, lineIdx);
  return n === null ? null : String(n);
}

function topOfHunk(loc: HunkLocation): string | null {
  if (typeof loc.hunk.newStart === "number" && loc.hunk.newStart > 0) {
    return String(loc.hunk.newStart);
  }
  // Fallback: walk for the first line with a numeric line no.
  for (const line of loc.hunk.lines) {
    const n = line.newNo ?? line.oldNo;
    if (typeof n === "number") return String(n);
  }
  return null;
}

// Sort + sanitize: kept in sync with server/src/agent-queue.ts. If you
// change one, change the other.

function sortForPayload(comments: DraftComment[]): DraftComment[] {
  const decorated = comments.map((c, i) => ({
    c,
    i,
    isFreeform: c.file === undefined && c.lines === undefined,
    fileKey: c.file ?? "",
    lineKey: linesLowerBound(c.lines),
  }));
  decorated.sort((a, b) => {
    if (a.isFreeform !== b.isFreeform) return a.isFreeform ? 1 : -1;
    if (a.isFreeform) return a.i - b.i;
    if (a.fileKey !== b.fileKey) return a.fileKey < b.fileKey ? -1 : 1;
    if (a.lineKey !== b.lineKey) return a.lineKey - b.lineKey;
    return a.i - b.i;
  });
  return decorated.map((d) => d.c);
}

function linesLowerBound(lines: string | undefined): number {
  if (lines === undefined) return Number.POSITIVE_INFINITY;
  const dash = lines.indexOf("-");
  const head = dash === -1 ? lines : lines.slice(0, dash);
  const n = parseInt(head, 10);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function sanitizeBody(body: string): string {
  let out = body.replace(/<\/comment>/gi, "</ comment>");
  out = out.replace(/]]>/g, "]]&gt;");
  return out;
}
