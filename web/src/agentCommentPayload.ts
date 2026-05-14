// Resolve a reply-target key + the active ChangeSet onto the {target, file,
// lines} triple the /api/agent/enqueue endpoint expects. Lives in its own
// module so the derivation is unit-testable without standing up the App.
// See docs/plans/share-review-comments.md § Format the agent sees for the
// wire shape — `lines` is a string of file line numbers, not array indices.
// The caller fills in `intent`, `author`, `authorRole`; this helper only
// resolves topology.

import type { ChangeSet, InteractionTarget } from "./types";

export interface DerivedCommentPayload {
  target: InteractionTarget;
  /** Repo-relative file path. */
  file: string;
  /** `"118"` for a single line; `"72-79"` for a range. Omitted for thread
   *  targets where line context isn't meaningful (hunkSummary, teammate). */
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
      // Note/user payloads are line-scoped; a target+file without `lines`
      // would be wire-malformed. Treat out-of-bounds lineIdx the same as a
      // stale hunk: caller should skip enqueueing.
      if (typeof lineNo !== "number") return null;
      const target: InteractionTarget =
        prefix === "note" ? "reply" : "line";
      return { target, file: located.file.path, lines: String(lineNo) };
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
      if (typeof loNo !== "number" || typeof hiNo !== "number") return null;
      return {
        target: "block",
        file: located.file.path,
        lines: loNo === hiNo ? String(loNo) : `${loNo}-${hiNo}`,
      };
    }
    case "hunkSummary": {
      const located = locateHunk(cs, rest);
      if (!located) return null;
      return { target: "reply", file: located.file.path };
    }
    case "teammate": {
      const located = locateHunk(cs, rest);
      if (!located) return null;
      return { target: "reply", file: located.file.path };
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
