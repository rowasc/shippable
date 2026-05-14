import { describe, expect, it } from "vitest";
import { buildStructureMap } from "./plan";
import type { ChangeSet, DiffFile, Hunk } from "./types";

function hunk(
  id: string,
  defines: string[],
  exported: string[] = [],
  references: string[] = [],
): Hunk {
  return {
    id,
    header: `@@ ${id} @@`,
    oldStart: 1,
    oldCount: 0,
    newStart: 1,
    newCount: 1,
    lines: [{ kind: "add", text: defines.join(" ") }],
    definesSymbols: defines,
    exportedSymbols: exported,
    referencesSymbols: references,
  };
}

function file(path: string, hunks: Hunk[]): DiffFile {
  return {
    id: `cs/${path}`,
    path,
    language: "ts",
    status: "added",
    hunks,
  };
}

function cs(files: DiffFile[]): ChangeSet {
  return {
    id: "cs",
    title: "t",
    author: "u",
    branch: "feat",
    base: "main",
    createdAt: "2026-05-13T00:00:00Z",
    description: "",
    files,
  };
}

describe("buildStructureMap exported-symbol filter", () => {
  it("keeps an exported symbol even with zero in-diff consumers", () => {
    const map = buildStructureMap(
      cs([file("api.ts", [hunk("h1", ["PublicThing"], ["PublicThing"])])]),
    );
    const names = map.symbols.map((s) => s.name);
    expect(names).toContain("PublicThing");
    const entry = map.symbols.find((s) => s.name === "PublicThing")!;
    expect(entry.exported).toBe(true);
    expect(entry.referencedIn).toEqual([]);
  });

  it("drops a non-exported symbol with zero in-diff consumers", () => {
    const map = buildStructureMap(
      cs([file("internal.ts", [hunk("h1", ["privateHelper"])])]),
    );
    expect(map.symbols.map((s) => s.name)).not.toContain("privateHelper");
  });

  it("keeps a non-exported symbol that has at least one in-diff consumer", () => {
    const map = buildStructureMap(
      cs([
        file("a.ts", [hunk("h1", ["helper"])]),
        file("b.ts", [hunk("h2", [], [], ["helper"])]),
      ]),
    );
    const entry = map.symbols.find((s) => s.name === "helper")!;
    expect(entry).toBeDefined();
    expect(entry.exported).toBe(false);
    expect(entry.referencedIn).toEqual(["b.ts"]);
  });

  it("keeps an exported symbol that also has in-diff consumers", () => {
    const map = buildStructureMap(
      cs([
        file("a.ts", [hunk("h1", ["Shared"], ["Shared"])]),
        file("b.ts", [hunk("h2", [], [], ["Shared"])]),
      ]),
    );
    const entry = map.symbols.find((s) => s.name === "Shared")!;
    expect(entry.exported).toBe(true);
    expect(entry.referencedIn).toEqual(["b.ts"]);
  });

  it("promotes to exported when a later hunk re-declares the name with `export`", () => {
    const map = buildStructureMap(
      cs([
        file("a.ts", [
          hunk("h1", ["Thing"]),
          hunk("h2", ["Thing"], ["Thing"]),
        ]),
      ]),
    );
    const entry = map.symbols.find((s) => s.name === "Thing")!;
    expect(entry).toBeDefined();
    expect(entry.exported).toBe(true);
  });

  it("drops the expected fraction of symbols on a mixed fixture", () => {
    // 9 defined names, characterised:
    //   exported (4):                  Api, ApiHelper, Config, Result
    //   non-exported with refs (2):    internalUsed, mathHelper
    //   non-exported zero-ref (3):     internalUnused, scratchA, scratchB
    // Expected in map: 4 + 2 = 6 entries; the 3 non-exported zero-refs dropped.
    const map = buildStructureMap(
      cs([
        file("api.ts", [
          hunk(
            "h1",
            ["Api", "ApiHelper", "Config", "Result", "internalUsed", "internalUnused"],
            ["Api", "ApiHelper", "Config", "Result"],
          ),
        ]),
        file("internal.ts", [
          hunk(
            "h2",
            ["mathHelper", "scratchA", "scratchB"],
            [],
            ["internalUsed"],
          ),
        ]),
        file("consumer.ts", [hunk("h3", [], [], ["mathHelper"])]),
      ]),
    );

    const present = new Set(map.symbols.map((s) => s.name));
    expect(present).toEqual(
      new Set([
        "Api",
        "ApiHelper",
        "Config",
        "Result",
        "internalUsed",
        "mathHelper",
      ]),
    );
    expect(present.has("internalUnused")).toBe(false);
    expect(present.has("scratchA")).toBe(false);
    expect(present.has("scratchB")).toBe(false);

    // Concrete savings claim: 3 of 9 raw definitions (33%) dropped on this shape.
    expect(map.symbols).toHaveLength(6);
  });
});
