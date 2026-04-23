import type { Cursor, ChangeSet } from "./types";

export type SymbolIndex = Map<string, Cursor>;

export function buildSymbolIndex(cs: ChangeSet): SymbolIndex {
  const index: SymbolIndex = new Map();
  for (const file of cs.files) {
    for (const hunk of file.hunks) {
      if (!hunk.definesSymbols?.length) continue;
      for (const sym of hunk.definesSymbols) {
        if (index.has(sym)) continue;
        const lineIdx = Math.max(
          0,
          hunk.lines.findIndex((l) => l.text.includes(sym)),
        );
        index.set(sym, {
          changesetId: cs.id,
          fileId: file.id,
          hunkId: hunk.id,
          lineIdx,
        });
      }
    }
  }
  return index;
}
