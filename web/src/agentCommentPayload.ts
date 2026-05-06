// Map a reply-target key + the active ChangeSet onto the {kind, file, lines}
// triple that /api/agent/enqueue expects. Lives in its own module so the
// derivation is unit-testable without standing up the App. See
// docs/plans/share-review-comments.md § Format the agent sees for the wire
// shape — `lines` is a string of file line numbers, not array indices.

import type { ChangeSet, CommentKind } from "./types";

export interface DerivedCommentPayload {
  kind: CommentKind;
  /** Repo-relative file path. Omitted for `freeform`. */
  file?: string;
  /** `"118"` for a single line; `"72-79"` for a range. Omitted for thread
   *  kinds where line context isn't meaningful (hunkSummary, teammate, freeform). */
  lines?: string;
}

/**
 * Returns null when the targetKey can't be resolved against the changeset
 * (stale hunk, etc.). Caller should skip enqueueing in that case rather than
 * sending a malformed payload.
 */
export function deriveCommentPayload(
  targetKey: string,
  cs: ChangeSet,
): DerivedCommentPayload | null {
  const colon = targetKey.indexOf(":");
  if (colon < 0) return null;
  const prefix = targetKey.slice(0, colon);
  const rest = targetKey.slice(colon + 1);

  switch (prefix) {
    case "note":
    case "user": {
      // `note:hunkId:lineIdx` / `user:hunkId:lineIdx` — last colon splits
      // hunkId from lineIdx (hunk ids may contain `/` and `#`, but no `:`).
      const lastColon = rest.lastIndexOf(":");
      if (lastColon < 0) return null;
      const hunkId = rest.slice(0, lastColon);
      const lineIdx = Number(rest.slice(lastColon + 1));
      if (!Number.isFinite(lineIdx)) return null;
      const located = locateHunk(cs, hunkId);
      if (!located) return null;
      const line = located.hunk.lines[lineIdx];
      const lineNo = line?.newNo ?? line?.oldNo;
      const kind: CommentKind = prefix === "note" ? "reply-to-ai-note" : "line";
      const out: DerivedCommentPayload = { kind, file: located.file.path };
      if (typeof lineNo === "number") out.lines = String(lineNo);
      return out;
    }
    case "block": {
      // `block:hunkId:lo-hi` — array indices into the hunk's lines.
      const lastColon = rest.lastIndexOf(":");
      if (lastColon < 0) return null;
      const hunkId = rest.slice(0, lastColon);
      const range = rest.slice(lastColon + 1);
      const dash = range.indexOf("-");
      if (dash < 0) return null;
      const lo = Number(range.slice(0, dash));
      const hi = Number(range.slice(dash + 1));
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
      const located = locateHunk(cs, hunkId);
      if (!located) return null;
      const loLine = located.hunk.lines[lo];
      const hiLine = located.hunk.lines[hi];
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
    case "hunkSummary": {
      const located = locateHunk(cs, rest);
      if (!located) return null;
      return { kind: "reply-to-hunk-summary", file: located.file.path };
    }
    case "teammate": {
      const located = locateHunk(cs, rest);
      if (!located) return null;
      return { kind: "reply-to-teammate", file: located.file.path };
    }
    default:
      return null;
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
