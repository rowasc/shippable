import type { DiffFile, DiffLine, Hunk } from "./types";

/**
 * Maximum lines included in a single expand-block. Larger gaps split into
 * multiple blocks so the reviewer reveals context in readable chunks.
 */
const MAX_BLOCK_LINES = 20;

/**
 * Enrich a parsed DiffFile with `expandAbove`/`expandBelow` blocks per hunk
 * and a flat `fullContent` representation, derived from the post-change file
 * text. Skipped for added/deleted files (no surrounding context exists) and
 * for hunks that already carry expand blocks (fixtures hand-craft their own).
 *
 * Why post-change-only: worktree ingest hands us the new file content via
 * `fileContents`. Context lines outside hunk ranges are unchanged between
 * old and new, so we can read them straight off the post-change file using
 * `newNo` indices.
 */
export function enrichWithFileContent(
  file: DiffFile,
  postChangeText: string,
): DiffFile {
  if (file.status === "deleted") return file;

  const fileLines = postChangeText.split(/\r?\n/);
  // Trailing newline produces an empty trailing element; drop it so line
  // counts match `wc -l`.
  if (fileLines.length > 0 && fileLines[fileLines.length - 1] === "") {
    fileLines.pop();
  }

  const hunks = file.hunks.map((hunk, idx) => {
    const prevHunkEnd =
      idx === 0 ? 0 : endOfHunk(file.hunks[idx - 1]);
    const nextHunkStart =
      idx === file.hunks.length - 1
        ? fileLines.length + 1
        : file.hunks[idx + 1].newStart;

    const expandAbove =
      hunk.expandAbove ??
      buildExpandAbove(fileLines, prevHunkEnd + 1, hunk.newStart - 1);
    const expandBelow =
      hunk.expandBelow ??
      buildExpandBelow(fileLines, endOfHunk(hunk) + 1, nextHunkStart - 1);

    return { ...hunk, expandAbove, expandBelow };
  });

  const fullContent = file.fullContent ?? buildFullContent(fileLines, hunks);

  return { ...file, hunks, fullContent };
}

/** Last `newNo` covered by a hunk. Hunks with `newCount: 0` don't contribute. */
function endOfHunk(hunk: Hunk): number {
  return hunk.newCount === 0 ? hunk.newStart - 1 : hunk.newStart + hunk.newCount - 1;
}

/**
 * Above-blocks are ordered nearest → farthest. We walk upward from the line
 * just above the hunk, accumulating lines into a block until we hit a blank
 * line (a natural reading boundary) or the block reaches MAX_BLOCK_LINES.
 * Empty result when there's no room above.
 */
function buildExpandAbove(
  fileLines: string[],
  startNewNo: number,
  endNewNo: number,
): DiffLine[][] {
  if (startNewNo > endNewNo) return [];

  const blocks: DiffLine[][] = [];
  let cursor = endNewNo; // walk upward
  while (cursor >= startNewNo) {
    const block: DiffLine[] = [];
    while (cursor >= startNewNo && block.length < MAX_BLOCK_LINES) {
      const text = fileLines[cursor - 1] ?? "";
      block.push({ kind: "context", text, oldNo: cursor, newNo: cursor });
      cursor--;
      // A blank line ends this block on its near edge — the next click
      // continues from above the blank.
      if (text.trim() === "" && block.length > 1) break;
    }
    // Block was built bottom-up (nearest line pushed first); reverse so the
    // rendered order is top-to-bottom.
    block.reverse();
    blocks.push(block);
  }
  return blocks;
}

/**
 * Below-blocks are ordered nearest → farthest. Walk downward from the line
 * just after the hunk; same blank-line / max-size chunking.
 */
function buildExpandBelow(
  fileLines: string[],
  startNewNo: number,
  endNewNo: number,
): DiffLine[][] {
  if (startNewNo > endNewNo) return [];

  const blocks: DiffLine[][] = [];
  let cursor = startNewNo;
  while (cursor <= endNewNo) {
    const block: DiffLine[] = [];
    while (cursor <= endNewNo && block.length < MAX_BLOCK_LINES) {
      const text = fileLines[cursor - 1] ?? "";
      block.push({ kind: "context", text, oldNo: cursor, newNo: cursor });
      cursor++;
      if (text.trim() === "" && block.length > 1) break;
    }
    blocks.push(block);
  }
  return blocks;
}

/**
 * Stitch hunk lines into the post-change file so the full-file view shows
 * dels alongside surrounding context. Lines outside any hunk's
 * `[newStart, newStart+newCount-1]` window become plain context.
 */
function buildFullContent(fileLines: string[], hunks: Hunk[]): DiffLine[] {
  const out: DiffLine[] = [];
  let cursor = 1; // 1-based newNo index into fileLines
  const sorted = [...hunks].sort((a, b) => a.newStart - b.newStart);

  for (const hunk of sorted) {
    while (cursor < hunk.newStart) {
      out.push({
        kind: "context",
        text: fileLines[cursor - 1] ?? "",
        oldNo: cursor,
        newNo: cursor,
      });
      cursor++;
    }
    out.push(...hunk.lines);
    cursor = hunk.newStart + hunk.newCount;
  }

  while (cursor <= fileLines.length) {
    out.push({
      kind: "context",
      text: fileLines[cursor - 1] ?? "",
      oldNo: cursor,
      newNo: cursor,
    });
    cursor++;
  }

  return out;
}
