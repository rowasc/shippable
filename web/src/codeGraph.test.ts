import { describe, expect, it } from "vitest";
import { buildDiffCodeGraph } from "./codeGraph";
import type { DiffFile } from "./types";

function diffFile(path: string, addedLines: string[]): DiffFile {
  return {
    id: `cs/${path}`,
    path,
    language: "ts",
    status: "added",
    hunks: [
      {
        id: `${path}#h1`,
        header: "@@ h1 @@",
        oldStart: 1,
        oldCount: 0,
        newStart: 1,
        newCount: addedLines.length,
        lines: addedLines.map((text) => ({ kind: "add" as const, text })),
      },
    ],
  };
}

describe("buildDiffCodeGraph exported-symbol detection", () => {
  it("marks `export`-prefixed declarations as exported and leaves bare ones unmarked", () => {
    const { files } = buildDiffCodeGraph([
      diffFile("api.ts", [
        "export function publicFn() {",
        "  return helper();",
        "}",
        "function helper() {",
        "  return 1;",
        "}",
        "export const PublicConst = 42;",
        "const internalConst = 7;",
      ]),
    ]);
    const hunk = files[0].hunks[0];
    expect(hunk.definesSymbols?.sort()).toEqual(
      ["PublicConst", "helper", "internalConst", "publicFn"].sort(),
    );
    expect(hunk.exportedSymbols?.sort()).toEqual(
      ["PublicConst", "publicFn"].sort(),
    );
  });
});
