// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadRecents, pushRecent, type RecentSource } from "./recents";
import type { ChangeSet, DiffFile, DiffLine, Hunk } from "./types";

const STORAGE_KEY = "shippable:recents:v1";

function makeHunk(id: string): Hunk {
  const lines: DiffLine[] = [
    { kind: "context", text: "l0", oldNo: 1, newNo: 1 },
  ];
  return {
    id,
    header: "@@ -1,1 +1,1 @@",
    oldStart: 1,
    oldCount: 1,
    newStart: 1,
    newCount: 1,
    lines,
  };
}

function makeFile(id: string, hunks: Hunk[]): DiffFile {
  return { id, path: `${id}.ts`, language: "ts", status: "modified", hunks };
}

function makeCs(id: string, files: DiffFile[]): ChangeSet {
  return {
    id,
    title: id,
    author: "tester",
    branch: "head",
    base: "base",
    createdAt: "2026-05-13T00:00:00.000Z",
    description: "",
    files,
  };
}

const source: RecentSource = { kind: "paste" };

afterEach(() => {
  localStorage.clear();
});

describe("pushRecent — poisoned-recent guard", () => {
  // A clean worktree reload calls parseDiff("") → files: []. Storing that
  // changeset poisoned the next boot (see persist.test.ts coverage).
  it("refuses to persist a changeset with no files", () => {
    expect(pushRecent(makeCs("wt-clean", []), {}, source)).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("refuses to persist a changeset whose files all have empty hunks", () => {
    const cs = makeCs("wt-empty-hunks", [makeFile("f1", []), makeFile("f2", [])]);
    expect(pushRecent(cs, {}, source)).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("persists a normal changeset", () => {
    const cs = makeCs("cs1", [makeFile("f1", [makeHunk("f1#h1")])]);
    const next = pushRecent(cs, {}, source);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("cs1");
    expect(loadRecents()).toHaveLength(1);
  });
});
