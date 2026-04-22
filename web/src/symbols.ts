import type { Cursor, PullRequest } from "./types";

export type SymbolIndex = Map<string, Cursor>;

export function buildSymbolIndex(pr: PullRequest): SymbolIndex {
  const index: SymbolIndex = new Map();
  for (const file of pr.files) {
    for (const hunk of file.hunks) {
      if (!hunk.definesSymbols?.length) continue;
      for (const sym of hunk.definesSymbols) {
        if (index.has(sym)) continue;
        const lineIdx = Math.max(
          0,
          hunk.lines.findIndex((l) => l.text.includes(sym)),
        );
        index.set(sym, {
          prId: pr.id,
          fileId: file.id,
          hunkId: hunk.id,
          lineIdx,
        });
      }
    }
  }
  return index;
}
