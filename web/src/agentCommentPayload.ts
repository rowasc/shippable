// Map a reply-target key + the active ChangeSet onto the {kind, file, lines}
// triple that /api/agent/enqueue expects. Lives in its own module so the
// derivation is unit-testable without standing up the App. See
// docs/plans/share-review-comments.md § Format the agent sees for the wire
// shape — `lines` is a string of file line numbers, not array indices.

import type { AgentComment, ChangeSet, CommentKind } from "./types";
import { parseReplyKey } from "./types";

export interface DerivedCommentPayload {
  kind: CommentKind;
  /** Repo-relative file path. */
  file: string;
  /** `"118"` for a single line; `"72-79"` for a range. Omitted for thread
   *  kinds where line context isn't meaningful (hunkSummary, teammate). */
  lines?: string;
  /**
   * Server-minted `AgentComment.id` for the parent. Set only when
   * `kind === "reply-to-agent-comment"`. The enqueue endpoint requires it.
   */
  parentAgentCommentId?: string;
}

/**
 * Returns null when the targetKey can't be resolved (stale hunk, missing
 * agent-comment, etc.). Caller should skip enqueueing in that case rather
 * than sending a malformed payload.
 *
 * Agent-comment threads are looked up by id in the `agentComments` slot
 * rather than by hunk position in the changeset. Pass that slot in so the
 * function can resolve the anchor `file` and `lines`.
 */
export function deriveCommentPayload(
  targetKey: string,
  cs: ChangeSet,
  agentComments: AgentComment[] = [],
): DerivedCommentPayload | null {
  const parsed = parseReplyKey(targetKey);
  if (!parsed) return null;

  if (parsed.kind === "agentComment") {
    const parent = agentComments.find((c) => c.id === parsed.agentCommentId);
    if (!parent || !parent.anchor) return null;
    return {
      kind: "reply-to-agent-comment",
      file: parent.anchor.file,
      lines: parent.anchor.lines,
      parentAgentCommentId: parent.id,
    };
  }

  const located = locateHunk(cs, parsed.hunkId);
  if (!located) return null;

  switch (parsed.kind) {
    case "note":
    case "user": {
      const line = located.hunk.lines[parsed.lineIdx];
      const lineNo = line?.newNo ?? line?.oldNo;
      const kind: CommentKind =
        parsed.kind === "note" ? "reply-to-ai-note" : "line";
      const out: DerivedCommentPayload = { kind, file: located.file.path };
      if (typeof lineNo === "number") out.lines = String(lineNo);
      return out;
    }
    case "block": {
      const loLine = located.hunk.lines[parsed.lo];
      const hiLine = located.hunk.lines[parsed.hi];
      const loNo = loLine?.newNo ?? loLine?.oldNo;
      const hiNo = hiLine?.newNo ?? hiLine?.oldNo;
      const out: DerivedCommentPayload = {
        kind: "block",
        file: located.file.path,
      };
      if (typeof loNo === "number" && typeof hiNo === "number") {
        out.lines = loNo === hiNo ? String(loNo) : `${loNo}-${hiNo}`;
      }
      return out;
    }
    case "hunkSummary":
      return { kind: "reply-to-hunk-summary", file: located.file.path };
    case "teammate":
      return { kind: "reply-to-teammate", file: located.file.path };
  }
}

function locateHunk(
  cs: ChangeSet,
  hunkId: string,
): { file: ChangeSet["files"][number]; hunk: ChangeSet["files"][number]["hunks"][number] } | null {
  for (const file of cs.files) {
    const hunk = file.hunks.find((h) => h.id === hunkId);
    if (hunk) return { file, hunk };
  }
  return null;
}
