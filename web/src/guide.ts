import type { PullRequest, ReviewState } from "./types";
import { hunkCoverage } from "./state";

export interface GuideSuggestion {
  id: string;
  symbol: string;
  fromHunkId: string;
  toFileId: string;
  toHunkId: string;
  toLineIdx: number;
  reason: string;
}

/**
 * Fires when the cursor is on a hunk that references a symbol defined in
 * another hunk in the same PR, the user has visited more than half of the
 * current hunk, and the target hunk is still mostly unreviewed.
 */
export function maybeSuggest(
  pr: PullRequest,
  state: ReviewState,
): GuideSuggestion | null {
  const file = pr.files.find((f) => f.id === state.cursor.fileId);
  if (!file) return null;
  const hunk = file.hunks.find((h) => h.id === state.cursor.hunkId);
  if (!hunk || !hunk.referencesSymbols?.length) return null;

  if (hunkCoverage(hunk, state.reviewedLines) < 0.5) return null;

  for (const symbol of hunk.referencesSymbols) {
    for (const otherFile of pr.files) {
      if (otherFile.id === file.id) continue;
      for (const otherHunk of otherFile.hunks) {
        if (!otherHunk.definesSymbols?.includes(symbol)) continue;
        if (hunkCoverage(otherHunk, state.reviewedLines) > 0.8) continue;
        const guideId = `${hunk.id}->${otherHunk.id}:${symbol}`;
        if (state.dismissedGuides.has(guideId)) continue;
        return {
          id: guideId,
          symbol,
          fromHunkId: hunk.id,
          toFileId: otherFile.id,
          toHunkId: otherHunk.id,
          toLineIdx: otherHunk.lines.findIndex((l) => l.text.includes(symbol)) >= 0
            ? otherHunk.lines.findIndex((l) => l.text.includes(symbol))
            : 0,
          reason: `You're reading code that calls ${symbol}. Review its definition in ${otherFile.path} before moving on?`,
        };
      }
    }
  }
  return null;
}
