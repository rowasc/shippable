import type { ChangeSet, ReviewState } from "./types";
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
 * Fires when the cursor is sitting on (or has passed) a line that
 * references a symbol defined in another hunk in the same changeset,
 * and that target hunk is still mostly unread. The earlier-the-better
 * trigger catches reviewers before they lose the thread of where the
 * called function is defined.
 */
export function maybeSuggest(
  cs: ChangeSet,
  state: ReviewState,
): GuideSuggestion | null {
  const file = cs.files.find((f) => f.id === state.cursor.fileId);
  if (!file) return null;
  const hunk = file.hunks.find((h) => h.id === state.cursor.hunkId);
  if (!hunk || !hunk.referencesSymbols?.length) return null;

  for (const symbol of hunk.referencesSymbols) {
    // Find the first line in this hunk that mentions the symbol. If we
    // can't find one, fall back to "any line in the hunk" (lineIdx 0).
    const refLineIdx = hunk.lines.findIndex((l) => l.text.includes(symbol));
    const triggerAt = refLineIdx >= 0 ? refLineIdx : 0;
    if (state.cursor.lineIdx < triggerAt) continue;

    for (const otherFile of cs.files) {
      if (otherFile.id === file.id) continue;
      for (const otherHunk of otherFile.hunks) {
        if (!otherHunk.definesSymbols?.includes(symbol)) continue;
        if (hunkCoverage(otherHunk, state.readLines) > 0.8) continue;
        const guideId = `${hunk.id}->${otherHunk.id}:${symbol}`;
        if (state.dismissedGuides.has(guideId)) continue;
        const defLineIdx = otherHunk.lines.findIndex((l) =>
          l.text.includes(symbol),
        );
        return {
          id: guideId,
          symbol,
          fromHunkId: hunk.id,
          toFileId: otherFile.id,
          toHunkId: otherHunk.id,
          toLineIdx: defLineIdx >= 0 ? defLineIdx : 0,
          reason: `You're reading code that calls ${symbol}. Review its definition in ${otherFile.path} before moving on?`,
        };
      }
    }
  }
  return null;
}
